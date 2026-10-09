import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  assessPhoto,
  PHOTO_INTEGRITY_RULES,
  PHOTO_SOURCES,
  type EarlierPhoto,
  type LocalizedText,
  type PhotoPlace,
  type PhotoSource,
  type PhotoSubjectDto,
} from '@eccs/shared';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import { fingerprintPhoto } from './photo-fingerprint.js';

// Photo integrity on the server. Two steps, both of which only ever ADD
// information to a photo; neither can refuse a photo or fail an upload.
//
//  1. When the file arrives (`captureColumns`): keep what the phone said about
//     it (its own time, where it was, whether the camera took it) and work out
//     the file's two fingerprints.
//  2. When the photo becomes proof of something (`assess`): compare it with the
//     outlet's location, the server's clock and the outlet's earlier proof
//     photos, and store the reasons for doubt, if any. The rules themselves are
//     in packages/shared/src/photo-integrity.ts.
//
// Proof ("evidence") means: the photo of a checklist check, a visit's before
// or after photo, a photo of an inspection finding. Photos attached to an
// issue, documents and profile photos are never assessed.

/** A number sent as text in an upload form. Anything unreadable is ignored instead of failing the upload. */
const formNumber = (min: number, max: number) =>
  z
    .preprocess((value) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value), z.number().min(min).max(max))
    .optional()
    .catch(undefined);

const photoFactsSchema = z.object({
  latitude: formNumber(-90, 90),
  longitude: formNumber(-180, 180),
  accuracy: formNumber(0, 100_000_000),
  mocked: z.enum(['true', 'false']).optional().catch(undefined),
  source: z.enum(PHOTO_SOURCES).optional().catch(undefined),
});

/** What a phone may say about a photo it sends, besides the picture itself. */
export interface PhotoFacts {
  place: PhotoPlace | null;
  source: PhotoSource | null;
}

/** Reads those facts from the fields of an upload. Never throws; what is missing or unreadable is simply not known. */
export function readPhotoFacts(body: unknown): PhotoFacts {
  const parsed = photoFactsSchema.safeParse(body ?? {});
  const fields = parsed.success ? parsed.data : {};
  const located = fields.latitude !== undefined && fields.longitude !== undefined;
  return {
    place: located
      ? {
          latitude: fields.latitude!,
          longitude: fields.longitude!,
          accuracy: fields.accuracy ?? null,
          mocked: fields.mocked === undefined ? null : fields.mocked === 'true',
        }
      : null,
    source: fields.source ?? null,
  };
}

const NO_FACTS: PhotoFacts = { place: null, source: null };

const DAY_MS = 86_400_000;
/** The calendar date in India, YYYY-MM-DD. */
const indiaDay = (at: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(at);
const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);

/** What is read of a photo, and of each earlier one, to judge it. */
const evidenceSelect = {
  id: true,
  outletId: true,
  kind: true,
  createdAt: true,
  phoneCapturedAt: true,
  source: true,
  contentHash: true,
  perceptualHash: true,
  latitude: true,
  longitude: true,
  locationAccuracy: true,
  locationMocked: true,
  checklistResponse: {
    select: {
      itemId: true,
      run: { select: { date: true, outletChecklist: { select: { template: { select: { title: true } } } } } },
    },
  },
  job: { select: { id: true, checkInAt: true, scheduledDate: true, serviceType: { select: { name: true } } } },
  inspectionFinding: { select: { id: true, inspection: { select: { createdAt: true, conductedAt: true } } } },
} as const satisfies Prisma.AttachmentSelect;

type EvidenceRow = Prisma.AttachmentGetPayload<{ select: typeof evidenceSelect }>;

/** Which attachments are proof of something: the same three cases as `evidenceOf` below. */
export const EVIDENCE_WHERE = {
  OR: [
    { checklistResponseId: { not: null } },
    { jobId: { not: null }, kind: { in: ['BEFORE', 'AFTER'] } },
    { inspectionFindingId: { not: null } },
  ],
} as const satisfies Prisma.AttachmentWhereInput;

interface Evidence {
  /** The same check, visit or finding gives the same key. */
  subject: string;
  /** The day (India) of the work the photo belongs to. */
  day: string;
  /** When that work began: no photo of it can honestly be older. */
  notBefore: Date | null;
  what: PhotoSubjectDto;
}

/** What a photo is proof of; `null` when it is not proof of anything (an issue's photo, a retaken checklist photo). */
function evidenceOf(row: EvidenceRow): Evidence | null {
  if (row.checklistResponse) {
    const day = fromDbDate(row.checklistResponse.run.date);
    return {
      subject: `item:${row.checklistResponse.itemId}`,
      day,
      // A checklist belongs to an Indian calendar day and cannot be filled in before that day begins.
      notBefore: new Date(`${day}T00:00:00.000+05:30`),
      what: { kind: 'CHECKLIST', name: row.checklistResponse.run.outletChecklist.template.title as LocalizedText },
    };
  }
  if (row.job && (row.kind === 'BEFORE' || row.kind === 'AFTER')) {
    return {
      subject: `visit:${row.job.id}`,
      day: row.job.checkInAt ? indiaDay(row.job.checkInAt) : fromDbDate(row.job.scheduledDate),
      // Photos can only be added after the Supervisor has checked in.
      notBefore: row.job.checkInAt,
      what: { kind: 'VISIT', name: row.job.serviceType.name as LocalizedText },
    };
  }
  if (row.inspectionFinding) {
    return {
      subject: `finding:${row.inspectionFinding.id}`,
      day: indiaDay(row.inspectionFinding.inspection.conductedAt),
      // The moment ECCS planned or started the inspection.
      notBefore: row.inspectionFinding.inspection.createdAt,
      what: { kind: 'INSPECTION', name: null },
    };
  }
  return null;
}

@Injectable()
export class PhotoIntegrityService {
  private readonly logger = new Logger(PhotoIntegrityService.name);

  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  /**
   * The integrity columns for a new attachment row, to spread into its `create`.
   * `capturedAt` is the phone's time exactly as it sent it (the row's own `capturedAt`
   * may be corrected to the server's time when the phone's clock is ahead); `receivedAt`
   * is the server's time, the same one stored as `createdAt`.
   */
  captureColumns(
    file: { buffer: Buffer; mimeType: string },
    capturedAt: string | undefined,
    receivedAt: Date,
    facts: PhotoFacts = NO_FACTS,
  ) {
    const said = capturedAt ? new Date(capturedAt) : null;
    const phoneCapturedAt = said && !Number.isNaN(said.getTime()) ? said : null;
    const fingerprint =
      file.mimeType.startsWith('image/') ? fingerprintPhoto(file.buffer, file.mimeType) : { contentHash: null, perceptualHash: null };
    return {
      createdAt: receivedAt,
      phoneCapturedAt,
      captureGapSeconds: phoneCapturedAt ? Math.round((receivedAt.getTime() - phoneCapturedAt.getTime()) / 1000) : null,
      source: facts.source,
      contentHash: fingerprint.contentHash,
      perceptualHash: fingerprint.perceptualHash,
      latitude: facts.place?.latitude ?? null,
      longitude: facts.place?.longitude ?? null,
      locationAccuracy: facts.place?.accuracy ?? null,
      locationMocked: facts.place?.mocked ?? null,
    } satisfies Partial<Prisma.AttachmentUncheckedCreateInput>;
  }

  /**
   * Judges a photo that has just become proof of something, and stores the reasons
   * for doubt with it (an empty list when there are none). Safe to run again.
   * Never throws: a failure here must not stop a checklist answer or a visit photo.
   */
  async assess(attachmentId: string): Promise<void> {
    try {
      const photo = await this.db.attachment.findUnique({ where: { id: attachmentId }, select: evidenceSelect });
      const evidence = photo ? evidenceOf(photo) : null;
      if (!photo || !evidence || !photo.outletId) return;

      const [outlet, earlierRows] = await Promise.all([
        this.db.outlet.findUnique({ where: { id: photo.outletId }, select: { latitude: true, longitude: true } }),
        // Earlier proof photos of the same outlet, newest first.
        this.db.attachment.findMany({
          where: {
            outletId: photo.outletId,
            id: { not: photo.id },
            createdAt: {
              gte: new Date(photo.createdAt.getTime() - PHOTO_INTEGRITY_RULES.duplicates.lookbackDays * DAY_MS),
              lte: photo.createdAt,
            },
            AND: [EVIDENCE_WHERE, { OR: [{ contentHash: { not: null } }, { perceptualHash: { not: null } }] }],
          },
          select: evidenceSelect,
          orderBy: { createdAt: 'desc' },
          take: 5000,
        }),
      ]);

      const earlier: EarlierPhoto[] = [];
      for (const row of earlierRows) {
        const was = evidenceOf(row);
        if (was) {
          earlier.push({ contentHash: row.contentHash, perceptualHash: row.perceptualHash, subject: was.subject, day: was.day, what: was.what });
        }
      }

      const result = assessPhoto({
        source: PHOTO_SOURCES.find((source) => source === photo.source) ?? null,
        phoneCapturedAt: photo.phoneCapturedAt,
        receivedAt: photo.createdAt,
        notBefore: evidence.notBefore,
        place:
          photo.latitude !== null && photo.longitude !== null
            ? { latitude: photo.latitude, longitude: photo.longitude, accuracy: photo.locationAccuracy, mocked: photo.locationMocked }
            : null,
        outlet,
        fingerprint: { contentHash: photo.contentHash, perceptualHash: photo.perceptualHash, subject: evidence.subject, day: evidence.day },
        earlier,
      });

      await this.db.attachment.update({
        where: { id: photo.id },
        data: {
          integrityFlags: result.flags as unknown as Prisma.InputJsonValue,
          doubtful: result.flags.length > 0,
          distanceMetres: result.distanceMetres,
          integrityCheckedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.warn(`Could not check photo ${attachmentId}: ${String(error)}`);
    }
  }
}
