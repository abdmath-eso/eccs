import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  cleanLicenceAnswer,
  EMPTY_READING,
  LICENCE_ANSWER_JSON_SCHEMA,
  licenceAnswerSchema,
  parseLicenceText,
  type AiModelId,
  type LicenceAnswer,
  type LicenceReadingDto,
} from '@eccs/shared';
import type { Worker } from 'tesseract.js';
import { LICENCE_READER_INSTRUCTIONS } from '../ai/ai-prompts.js';
import { AiService, type AiWho } from '../ai/ai.service.js';
import { indiaDate } from '../checklists/checklists.service.js';
import { env } from '../config/env.js';

const READ_TIMEOUT_MS = 45_000;
/** Five short fields: a few hundred tokens are plenty. */
const AI_MAX_OUTPUT_TOKENS = 600;

/**
 * Reads the licence type, number and dates off an uploaded licence document, so
 * the person adding it only has to check them.
 *
 * Two readers, chosen by LICENCE_READER:
 *
 * - "ai" (the default, 14 Oct 2026): the photo or PDF goes to the AI (the Claude
 *   API) with instructions to read only what is printed and never guess. Haiku
 *   reads it first; if it cannot read the number or the expiry date, Sonnet tries
 *   once (both models, and the second try, are set in the console since 19 Oct
 *   2026). Whenever AI is off, over its limit or fails, the free reader below
 *   answers instead. Everyone who may add a licence at the outlet gets the AI
 *   reader: the restaurant's Owner and Manager in the app and, since 15 Oct 2026,
 *   ECCS's Super Admin and Ops Manager in the console (the Head Chef and the
 *   Supervisor cannot add licences). Sends to the AI: the document, nothing else.
 * - "ocr": the free reader. The file is turned into plain text (a PDF's own text
 *   layer, or OCR with Tesseract running on our own server for an image), then
 *   `parseLicenceText` in @eccs/shared picks the details out. It often cannot read
 *   scanned PDFs, blurred or angled photos, or Telugu and Hindi text; the fields
 *   then simply stay empty.
 *
 * The apps only ever see the LicenceReadingDto; the AI one also carries the
 * business name it was issued to and the request's id.
 */
@Injectable()
export class LicenceReaderService implements OnModuleDestroy {
  private readonly logger = new Logger(LicenceReaderService.name);
  private worker: Promise<Worker> | null = null;
  // OCR jobs run one at a time: the recogniser handles a single image at once.
  private queue: Promise<unknown> = Promise.resolve();
  private mode = env.LICENCE_READER;

  constructor(private readonly ai: AiService) {}

  /** Tests only: which reader to use for this run. */
  setReaderForTest(mode: 'ai' | 'ocr' | 'off'): void {
    if (env.NODE_ENV !== 'test') throw new Error('The licence reader can only be switched in tests');
    this.mode = mode;
  }

  /**
   * Never throws: if the file cannot be read, every field comes back empty.
   * `aiFor` says who is asking and for which outlet (whose daily AI limit the cost
   * counts against); without it only the free reader is used.
   */
  async read(file: Buffer, mimeType: string, aiFor?: AiWho): Promise<LicenceReadingDto> {
    if (this.mode === 'off') return EMPTY_READING;
    if (this.mode === 'ai' && aiFor && this.ai.isOn('licence-reader')) {
      const reading = await this.readWithAi(file, mimeType, aiFor);
      if (reading) return reading;
    }
    try {
      const text = await withTimeout(this.textOf(file, mimeType), READ_TIMEOUT_MS);
      return parseLicenceText(text, indiaDate());
    } catch (error) {
      this.logger.warn(`Could not read licence document: ${String(error)}`);
      return EMPTY_READING;
    }
  }

  /**
   * The AI reader. Null when AI stepped aside (off, over its limit, failed), so the
   * free reader answers instead. A field the AI could not read comes back null,
   * and the app then says "Could not read: type it in".
   */
  private async readWithAi(file: Buffer, mimeType: string, who: AiWho): Promise<LicenceReadingDto | null> {
    const ask = (model: AiModelId) =>
      this.ai.run<LicenceAnswer>({
        feature: 'licence-reader',
        model,
        instructions: LICENCE_READER_INSTRUCTIONS,
        text: 'Read the details off this document.',
        file: { mimeType, data: file },
        answer: { schema: LICENCE_ANSWER_JSON_SCHEMA, check: licenceAnswerSchema },
        maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
        who,
        timeoutMs: READ_TIMEOUT_MS,
      });

    // Both models, and whether to try twice, are the console's AI settings (19 Oct 2026; Haiku
    // then Sonnet unless changed).
    const first = await ask(this.ai.modelFor('licence-reader'));
    if (!first.ok) return null;
    let answer = cleanLicenceAnswer(first.value);
    let requestId = first.requestId;
    // The number and the expiry date are what matter most: if the first model could not read
    // either, the stronger model tries once, and fills in what it read.
    const secondTry = this.ai.licenceSecondTry();
    if (secondTry.on && (!answer.number || !answer.expiresOn)) {
      const second = await ask(secondTry.model);
      if (second.ok) {
        const better = cleanLicenceAnswer(second.value);
        answer = cleanLicenceAnswer({
          type: better.type ?? answer.type,
          number: better.number ?? answer.number,
          issuedTo: better.issuedTo ?? answer.issuedTo,
          // The dates are taken as a pair from whichever model read the expiry.
          issuedOn: better.expiresOn ? better.issuedOn : (better.issuedOn ?? answer.issuedOn),
          expiresOn: better.expiresOn ?? answer.expiresOn,
        });
        requestId = second.requestId;
      }
    }
    const { type, number, issuedTo, issuedOn, expiresOn } = answer;
    return {
      type,
      number,
      issuedOn,
      expiresOn,
      textFound: [type, number, issuedTo, issuedOn, expiresOn].some((value) => value !== null),
      source: 'ai',
      issuedTo,
      aiRequestId: requestId,
    };
  }

  private async textOf(file: Buffer, mimeType: string): Promise<string> {
    if (mimeType === 'application/pdf') {
      const { extractText } = await import('unpdf');
      const { text } = await extractText(new Uint8Array(file), { mergePages: true });
      return text;
    }
    const job = this.queue.then(async () => {
      const worker = await this.ocrWorker();
      try {
        const result = await worker.recognize(file);
        return result.data.text;
      } catch (error) {
        // A file the recogniser cannot open can leave it in a bad state: start a fresh one next time.
        this.worker = null;
        await worker.terminate().catch(() => undefined);
        throw error;
      }
    });
    // Keep the queue going even if this job fails.
    this.queue = job.catch(() => undefined);
    return job;
  }

  /** Started on first use and kept, because starting the recogniser takes a few seconds. */
  private ocrWorker(): Promise<Worker> {
    if (!this.worker) {
      this.worker = (async () => {
        const { createWorker } = await import('tesseract.js');
        // The English language data (about 10 MB) is downloaded on first use and kept here.
        const cachePath = join(tmpdir(), 'eccs-ocr');
        mkdirSync(cachePath, { recursive: true });
        return createWorker('eng', 1, {
          cachePath,
          // Without this, a file the recogniser cannot open is thrown as an
          // uncaught error and would take the whole API down. The failure
          // still reaches the caller through the rejected recognise call.
          errorHandler: (error: unknown) => this.logger.warn(`OCR could not process a file: ${String(error)}`),
        });
      })();
      // If starting fails (for example no network for the first download), try again next time.
      this.worker.catch(() => {
        this.worker = null;
      });
    }
    return this.worker;
  }

  async onModuleDestroy() {
    const worker = await this.worker?.catch(() => null);
    await worker?.terminate();
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
