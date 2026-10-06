import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EMPTY_READING, parseLicenceText, type LicenceReadingDto } from '@eccs/shared';
import type { Worker } from 'tesseract.js';
import { indiaDate } from '../checklists/checklists.service.js';
import { env } from '../config/env.js';

const READ_TIMEOUT_MS = 45_000;

/**
 * Reads the licence number and dates off an uploaded licence document, so
 * the person adding it only has to check them.
 *
 * It works in two steps. First the file is turned into plain text: a PDF's
 * own text layer is used if it has one, and an image is put through OCR
 * (Tesseract, running here on our own server, so nothing leaves our systems).
 * Then `parseLicenceText` in @eccs/shared picks the details out of the text.
 *
 * Known limits of this free reader: scanned PDFs (pictures inside a PDF),
 * blurred or angled phone photos, and Telugu or Hindi text are often not
 * read, in which case the fields simply stay empty.
 *
 * To switch to an AI reader later: add a second way of producing a
 * LicenceReadingDto here (for example sending the file to Claude, which can
 * return the fields directly and copes with the cases above), choose between
 * them with the LICENCE_READER setting, and leave everything else as it is.
 * The apps only ever see the LicenceReadingDto.
 */
@Injectable()
export class LicenceReaderService implements OnModuleDestroy {
  private readonly logger = new Logger(LicenceReaderService.name);
  private worker: Promise<Worker> | null = null;
  // OCR jobs run one at a time: the recogniser handles a single image at once.
  private queue: Promise<unknown> = Promise.resolve();

  /** Never throws: if the file cannot be read, every field comes back empty. */
  async read(file: Buffer, mimeType: string): Promise<LicenceReadingDto> {
    if (env.LICENCE_READER === 'off') return EMPTY_READING;
    try {
      const text = await withTimeout(this.textOf(file, mimeType), READ_TIMEOUT_MS);
      return parseLicenceText(text, indiaDate());
    } catch (error) {
      this.logger.warn(`Could not read licence document: ${String(error)}`);
      return EMPTY_READING;
    }
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
