import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@eccs/db';
import {
  describePhotoFlag,
  indiaDay,
  localize,
  mainRole,
  orderFlags,
  QUALITY_RULES,
  readPhotoFlags,
  ROLE_LABELS,
  type LocalizedText,
  type PhotoFlagDto,
  type PhotoJudgedDto,
  type PhotoQueueDto,
  type PhotoQueueItemDto,
  type PhotoReviewKind,
  type PhotoVerdict,
  type QualityPhotoDto,
  type Role,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

// Quality > Photos (20 Oct 2026; docs/CONSOLE_PLAN.md 4.5). Doubtful proof photos were only
// counted (Monitoring) and marked on a visit; nobody judged them. Here a person does. One item
// per restaurant checklist (its doubtful photos, or the whole list ticked too fast) and one per
// ECCS visit (its doubtful before and after photos), from the photo-integrity marks of the last
// 14 days not yet judged. Accept settles it; Reject asks for a retake and tells the person: the
// outlet's Manager for a checklist (its Owner when there is no Manager), the visit's Supervisor
// for a visit. Each judgement is one PhotoReview row, which the photos and the run point back to,
// and rejections count on the Health board. A restaurant's checklist photos are otherwise not
// shown to ECCS: only the doubtful ones in this queue are (the plan, agreed 20 Oct 2026).

const DAY_MS = 86_400_000;
const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);

const photoSelect = {
  id: true,
  outletId: true,
  kind: true,
  createdAt: true,
  doubtful: true,
  integrityFlags: true,
  photoReviewId: true,
  uploadedById: true,
  checklistResponse: { select: { answeredById: true, item: { select: { label: true } }, runId: true } },
  jobId: true,
} as const satisfies Prisma.AttachmentSelect;
type PhotoRow = Prisma.AttachmentGetPayload<{ select: typeof photoSelect }>;

/** A checklist's or a visit's proof, gathered to judge. */
interface Group {
  kind: PhotoReviewKind;
  id: string;
  outletId: string;
  outletName: string;
  what: LocalizedText;
  date: string;
  photos: PhotoRow[];
  runFlags: PhotoFlagDto[];
  /** The run's speed is waiting to be judged. */
  runPending: boolean;
  /** When the work was handed in or the oldest photo came. */
  since: Date;
  supervisorId: string | null;
  supervisorName: string | null;
}

@Injectable()
export class PhotoReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** The queue, oldest first, with this month's judgements. */
  async queue(now: Date): Promise<PhotoQueueDto> {
    const groups = await this.groups(now);
    const people = await this.names(groups.flatMap((group) => group.photos.map((photo) => photo.uploadedById ?? photo.checklistResponse?.answeredById ?? null)));
    const managed = await this.outletsWithManagers([...new Set(groups.filter((group) => group.kind === 'CHECKLIST').map((group) => group.outletId))]);
    const monthStart = new Date(`${indiaDay(now).slice(0, 7)}-01T00:00:00.000+05:30`);
    const [judged, rejected] = await Promise.all([
      this.db.photoReview.count({ where: { reviewedAt: { gte: monthStart } } }),
      this.db.photoReview.count({ where: { reviewedAt: { gte: monthStart }, verdict: 'REJECTED' } }),
    ]);
    return {
      items: groups.map((group) => this.toItem(group, people, managed)),
      month: { judged, rejected },
    };
  }

  /** For Today and the badge: the items waiting, where, and the oldest one's first reason. */
  async waitingFacts(now: Date): Promise<{ items: number; outletNames: string[]; firstWhat: string; firstReason: string; oldestAt: string } | null> {
    const groups = await this.groups(now);
    const first = groups[0];
    if (!first) return null;
    const flags = [...first.runFlags, ...first.photos.flatMap((photo) => this.flagsOf(photo))];
    return {
      items: groups.length,
      outletNames: groups.map((group) => group.outletName),
      firstWhat: localize(first.what, 'EN'),
      firstReason: flags[0] ? describePhotoFlag(orderFlags(flags)[0]!) : 'doubtful',
      oldestAt: first.since.toISOString(),
    };
  }

  /** How many items wait, without building them. */
  async waitingCount(now: Date): Promise<number> {
    return (await this.groups(now)).length;
  }

  /**
   * Accept or reject one item. Only the photos the page showed (`photoIds`) that are still
   * waiting are judged, so a photo that came since is not judged unseen; a list ticked too fast
   * is judged with them. A rejection tells the person who has to retake.
   */
  async judge(user: AuthUser, input: { kind: PhotoReviewKind; id: string; photoIds: string[] }, verdict: PhotoVerdict, note: string | null, now: Date): Promise<PhotoJudgedDto> {
    const group = (await this.groups(now, { kind: input.kind, id: input.id }))[0];
    if (!group) throw new NotFoundException('Nothing is waiting to be judged here; it may have been judged already');
    const shown = new Set(input.photoIds);
    const photos = group.photos.filter((photo) => shown.has(photo.id) && photo.doubtful && !photo.photoReviewId);
    if (photos.length === 0 && !group.runPending) throw new ConflictException('These photos have just been judged');

    const review = await this.db.$transaction(async (tx) => {
      const made = await tx.photoReview.create({
        data: {
          outletId: group.outletId,
          kind: group.kind,
          runId: group.kind === 'CHECKLIST' ? group.id : null,
          jobId: group.kind === 'VISIT' ? group.id : null,
          verdict,
          note,
          photoIds: photos.map((photo) => photo.id),
          reasons: {
            run: group.runPending ? group.runFlags : [],
            photos: photos.map((photo) => ({ id: photo.id, flags: this.flagsOf(photo) })),
          } as unknown as Prisma.InputJsonValue,
          reviewedById: user.id,
          reviewedAt: now,
        },
      });
      // Claimed only while still waiting, so two people judging at once do not both count.
      const claimed = photos.length > 0 ? await tx.attachment.updateMany({ where: { id: { in: photos.map((photo) => photo.id) }, photoReviewId: null }, data: { photoReviewId: made.id } }) : { count: 0 };
      const run = group.runPending ? await tx.checklistRun.updateMany({ where: { id: group.id, photoReviewId: null }, data: { photoReviewId: made.id } }) : { count: 0 };
      if (claimed.count + run.count === 0) throw new ConflictException('These photos have just been judged');
      return made;
    });

    let told = 0;
    if (verdict === 'REJECTED') {
      told = await this.tell(group, note ?? '');
      await this.db.photoReview.update({ where: { id: review.id }, data: { told } });
    }
    return { reviewId: review.id, verdict, told };
  }

  /** For the Health board and the strip: judgements per outlet in a period. */
  async rejectedSince(outletIds: string[] | null, since: Date): Promise<Map<string, number>> {
    const rows = await this.db.photoReview.groupBy({
      by: ['outletId'],
      where: { verdict: 'REJECTED', reviewedAt: { gte: since }, ...(outletIds && { outletId: { in: outletIds } }) },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.outletId, row._count._all]));
  }

  // ───────────────────────── Gathering ─────────────────────────

  /** Every item waiting (or the one asked for), oldest first. */
  private async groups(now: Date, only?: { kind: PhotoReviewKind; id: string }): Promise<Group[]> {
    const since = new Date(now.getTime() - QUALITY_RULES.photoLookbackDays * DAY_MS);
    const live = { isActive: true, organization: { isActive: true } } as const;
    const proof: Prisma.AttachmentWhereInput = only
      ? only.kind === 'CHECKLIST'
        ? { checklistResponse: { runId: only.id } }
        : { jobId: only.id, kind: { in: ['BEFORE', 'AFTER'] } }
      : { OR: [{ checklistResponseId: { not: null } }, { jobId: { not: null }, kind: { in: ['BEFORE', 'AFTER'] } }] };

    const [doubtful, fastRuns] = await Promise.all([
      this.db.attachment.findMany({
        where: { ...proof, doubtful: true, photoReviewId: null, createdAt: { gte: since }, outlet: live },
        select: photoSelect,
        orderBy: { createdAt: 'asc' },
      }),
      !only || only.kind === 'CHECKLIST'
        ? this.db.checklistRun.findMany({
            where: {
              ...(only && { id: only.id }),
              integrityFlags: { not: Prisma.DbNull },
              photoReviewId: null,
              submittedAt: { gte: since },
              outlet: live,
            },
            select: { id: true, integrityFlags: true },
          })
        : Promise.resolve([]),
    ]);
    const tooFast = new Map(fastRuns.map((run) => [run.id, readPhotoFlags(run.integrityFlags)]).filter(([, flags]) => flags.length > 0) as [string, PhotoFlagDto[]][]);

    const runIds = [...new Set([...doubtful.map((photo) => photo.checklistResponse?.runId).filter((id): id is string => Boolean(id)), ...tooFast.keys()])];
    const jobIds = [...new Set(doubtful.map((photo) => (photo.checklistResponse ? null : photo.jobId)).filter((id): id is string => Boolean(id)))];
    const [runs, jobs, fastPhotos] = await Promise.all([
      runIds.length > 0
        ? this.db.checklistRun.findMany({
            where: { id: { in: runIds } },
            select: { id: true, outletId: true, date: true, submittedAt: true, outlet: { select: { name: true } }, outletChecklist: { select: { template: { select: { title: true } } } } },
          })
        : Promise.resolve([]),
      jobIds.length > 0
        ? this.db.job.findMany({
            where: { id: { in: jobIds } },
            select: { id: true, outletId: true, scheduledDate: true, checkInAt: true, supervisorId: true, supervisor: { select: { name: true } }, outlet: { select: { name: true } }, serviceType: { select: { name: true } } },
          })
        : Promise.resolve([]),
      // A list ticked too fast shows all its proof photos, flagged or not: the speed concerns them all.
      tooFast.size > 0
        ? this.db.attachment.findMany({ where: { checklistResponse: { runId: { in: [...tooFast.keys()] } } }, select: photoSelect, orderBy: { createdAt: 'asc' } })
        : Promise.resolve([]),
    ]);

    const groups = new Map<string, Group>();
    for (const run of runs) {
      groups.set(`CHECKLIST:${run.id}`, {
        kind: 'CHECKLIST',
        id: run.id,
        outletId: run.outletId,
        outletName: run.outlet.name,
        what: run.outletChecklist.template.title as LocalizedText,
        date: fromDbDate(run.date),
        photos: [],
        runFlags: tooFast.get(run.id) ?? [],
        runPending: tooFast.has(run.id),
        since: run.submittedAt ?? now,
        supervisorId: null,
        supervisorName: null,
      });
    }
    for (const job of jobs) {
      groups.set(`VISIT:${job.id}`, {
        kind: 'VISIT',
        id: job.id,
        outletId: job.outletId,
        outletName: job.outlet.name,
        what: job.serviceType.name as LocalizedText,
        date: job.checkInAt ? indiaDay(job.checkInAt) : fromDbDate(job.scheduledDate),
        photos: [],
        runFlags: [],
        runPending: false,
        since: now,
        supervisorId: job.supervisorId,
        supervisorName: job.supervisor?.name ?? null,
      });
    }
    const seen = new Set<string>();
    for (const photo of [...doubtful, ...fastPhotos]) {
      if (seen.has(photo.id)) continue;
      seen.add(photo.id);
      const key = photo.checklistResponse ? `CHECKLIST:${photo.checklistResponse.runId}` : `VISIT:${photo.jobId}`;
      const group = groups.get(key);
      if (!group) continue;
      group.photos.push(photo);
      if (photo.doubtful && !photo.photoReviewId && photo.createdAt < group.since) group.since = photo.createdAt;
    }
    return [...groups.values()]
      .filter((group) => group.runPending || group.photos.some((photo) => photo.doubtful && !photo.photoReviewId))
      .sort((a, b) => a.since.getTime() - b.since.getTime());
  }

  /** A photo's own reasons, while it waits; none once judged, or when it is shown only for its list's speed. */
  private flagsOf(photo: PhotoRow): PhotoFlagDto[] {
    return photo.doubtful && !photo.photoReviewId ? readPhotoFlags(photo.integrityFlags) : [];
  }

  private toItem(group: Group, people: Map<string, string>, managed: Set<string>): PhotoQueueItemDto {
    const photos: QualityPhotoDto[] = group.photos.map((photo) => {
      const taker = photo.uploadedById ?? photo.checklistResponse?.answeredById ?? null;
      return {
        id: photo.id,
        path: this.storage.signedPath(photo.id),
        kind: photo.kind === 'BEFORE' || photo.kind === 'AFTER' ? photo.kind : 'PROOF',
        itemLabel: (photo.checklistResponse?.item.label as LocalizedText | undefined) ?? null,
        flags: orderFlags(this.flagsOf(photo)),
        takenBy: taker ? (people.get(taker) ?? null) : null,
        receivedAt: photo.createdAt.toISOString(),
      };
    });
    const all = orderFlags([...group.runFlags, ...photos.flatMap((photo) => photo.flags)]);
    const reasons = [...new Set(all.map((flag) => describePhotoFlag(flag)))];
    return {
      key: `${group.kind}:${group.id}`,
      kind: group.kind,
      id: group.id,
      outletId: group.outletId,
      outletName: group.outletName,
      what: group.what,
      date: group.date,
      photos,
      runFlags: group.runFlags,
      reasons,
      certain: all.some((flag) => flag.certain),
      waitingSince: group.since.toISOString(),
      tells:
        group.kind === 'VISIT'
          ? group.supervisorName
            ? `${group.supervisorName}, the Supervisor`
            : 'The Supervisor'
          : managed.has(group.outletId)
            ? "The outlet's Manager"
            : "The restaurant's Owner (the outlet has no Manager)",
      visitId: group.kind === 'VISIT' ? group.id : null,
    };
  }

  /** "Kiran, Head Chef": each person's name with the role they hold. */
  private async names(ids: (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (wanted.length === 0) return new Map();
    const people = await this.db.user.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true, memberships: { select: { role: true } } } });
    return new Map(
      people.map((person) => {
        const role = mainRole(person.memberships.map((membership) => membership.role as Role));
        return [person.id, role ? `${person.name}, ${ROLE_LABELS[role]}` : person.name];
      }),
    );
  }

  private async outletsWithManagers(outletIds: string[]): Promise<Set<string>> {
    if (outletIds.length === 0) return new Set();
    const rows = await this.db.membership.findMany({
      where: { role: 'MANAGER', outletId: { in: outletIds }, user: { isActive: true } },
      select: { outletId: true },
    });
    return new Set(rows.map((row) => row.outletId).filter((id): id is string => Boolean(id)));
  }

  /** A rejection: the outlet's Managers (its Owners if it has none) for a checklist, the visit's Supervisor for a visit. */
  private async tell(group: Group, note: string): Promise<number> {
    const params = { outlet: group.outletName, what: group.what, note };
    if (group.kind === 'VISIT') {
      if (!group.supervisorId) return 0;
      return this.notifications.send([group.supervisorId], 'PHOTO_REJECTED', params, { kind: 'visit', visitId: group.id });
    }
    const managers = await this.notifications.restaurantPeople(group.outletId, ['MANAGER']);
    const people = managers.length > 0 ? managers : await this.notifications.restaurantPeople(group.outletId, ['OWNER']);
    return this.notifications.send(people, 'PHOTO_REJECTED', params, { kind: 'checklist', outletId: group.outletId, runId: group.id });
  }
}
