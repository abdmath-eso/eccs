import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  daysSince,
  followUpReason,
  followUpStanding,
  inspectionCause,
  isCriticalCheck,
  issueReopenedCause,
  localize,
  QUALITY_RULES,
  ratingCause,
  scoreDropCauses,
  sortFollowUps,
  VISIT_SLOTS,
  type FollowUpCause,
  type FollowUpCauseFound,
  type FollowUpDto,
  type FollowUpFacts,
  type FollowUpSource,
  type FollowUpsDto,
  type FollowUpStatus,
  type LocalizedText,
  type VisitSlot,
  type VisitStatus,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ServicesService } from '../services/services.service.js';

// Quality > Follow-ups (20 Oct 2026; docs/CONSOLE_PLAN.md 4.5). An unhappy kitchen comes in by
// itself: `sweep` reads the records the apps already keep and makes one FollowUp per cause, ever
// (the cause's key is unique in the table), for causes of the last 14 days:
// - a visit rated 3 stars or fewer: SignOff.rating;
// - an issue reopened: Issue.reopenedAt and reopenCount, written when the restaurant reopens it;
// - the hygiene score down 15 points in a week: the daily HygieneScoreSnapshot rows;
// - an inspection approved with no grade: Inspection.grade NON_COMPLIANT (any failed critical check gives it).
// It runs when Quality or Today is read, so the queue is always current without a timer. Nothing
// here changes a score. A follow-up leaves the queue when its free visit is finished, or when the
// office closes it with a note.

const DAY_MS = 86_400_000;
const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);
const toSlot = (slot: string | null): VisitSlot | null => VISIT_SLOTS.find((known) => known === slot) ?? null;
const english = (text: unknown) => localize(text as LocalizedText, 'EN');

const followUpInclude = {
  outlet: { select: { name: true, area: true } },
  calls: { orderBy: { at: 'desc' } },
} as const satisfies Prisma.FollowUpInclude;
type FollowUpRow = Prisma.FollowUpGetPayload<{ include: typeof followUpInclude }>;

/** The office's people who may be named as having made a call, and who may be told. */
const ECCS_ROLES = ['SUPER_ADMIN', 'OPS_MANAGER', 'SUPERVISOR'] as const;

@Injectable()
export class FollowUpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly services: ServicesService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  // ───────────────────────── Bringing outlets in ─────────────────────────

  /**
   * Brings in every cause of the last two weeks that is not in yet, and moves to DONE the open
   * ones whose free visit has been finished. Safe to run any number of times, also at once: a
   * cause already made is skipped by its unique key. Switched-off clients are left out.
   */
  async sweep(now: Date): Promise<void> {
    const since = new Date(now.getTime() - QUALITY_RULES.causeLookbackDays * DAY_MS);
    const live = { isActive: true, organization: { isActive: true } } as const;
    const [ratings, issues, inspections, snapshots] = await Promise.all([
      this.db.signOff.findMany({
        where: { rating: { lte: QUALITY_RULES.lowRatingStars }, signedAt: { gte: since }, job: { outlet: live } },
        select: { jobId: true, rating: true, comment: true, signedAt: true, job: { select: { outletId: true, scheduledDate: true, serviceType: { select: { name: true } } } } },
      }),
      this.db.issue.findMany({
        where: { reopenedAt: { gte: since }, reopenCount: { gt: 0 }, outlet: live },
        select: { id: true, outletId: true, reference: true, title: true, reopenedAt: true, reopenCount: true },
      }),
      this.db.inspection.findMany({
        where: { status: 'APPROVED', grade: 'NON_COMPLIANT', approvedAt: { gte: since }, outlet: live },
        select: {
          id: true,
          outletId: true,
          grade: true,
          approvedAt: true,
          conductedAt: true,
          overallScore: true,
          reportNumber: true,
          responses: { where: { answer: 'NON_COMPLIANT' }, select: { item: { select: { weight: true } } } },
        },
      }),
      // A week more than the causes, so a fall early in the window has the week before it.
      this.db.hygieneScoreSnapshot.findMany({
        where: { date: { gte: new Date(since.getTime() - QUALITY_RULES.scoreDropDays * DAY_MS) }, outlet: live },
        select: { outletId: true, date: true, score: true },
      }),
    ]);

    const found: FollowUpCauseFound[] = [];
    for (const row of ratings) {
      const cause = ratingCause({
        jobId: row.jobId,
        outletId: row.job.outletId,
        rating: row.rating,
        comment: row.comment,
        signedAt: row.signedAt.toISOString(),
        visitDate: fromDbDate(row.job.scheduledDate),
        serviceName: english(row.job.serviceType.name),
      });
      if (cause) found.push(cause);
    }
    for (const row of issues) {
      const cause = issueReopenedCause({
        id: row.id,
        outletId: row.outletId,
        reference: `ECCS-${String(row.reference).padStart(4, '0')}`,
        title: row.title,
        reopenedAt: row.reopenedAt?.toISOString() ?? null,
        reopenCount: row.reopenCount,
      });
      if (cause) found.push(cause);
    }
    for (const row of inspections) {
      const cause = inspectionCause({
        id: row.id,
        outletId: row.outletId,
        grade: row.grade,
        approvedAt: row.approvedAt?.toISOString() ?? null,
        conductedOn: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(row.conductedAt),
        score: row.overallScore,
        criticalFailed: row.responses.filter((response) => isCriticalCheck(response.item.weight)).length,
        reportNumber: row.reportNumber,
      });
      if (cause) found.push(cause);
    }
    const byOutlet = new Map<string, { date: string; score: number }[]>();
    for (const row of snapshots) {
      byOutlet.set(row.outletId, [...(byOutlet.get(row.outletId) ?? []), { date: fromDbDate(row.date), score: row.score }]);
    }
    // One score drop open at a time per outlet: a slide that goes on is still the one being handled.
    const dropOpen = new Set(
      (await this.db.followUp.findMany({ where: { cause: 'SCORE_DROP', status: 'OPEN' }, select: { outletId: true } })).map((row) => row.outletId),
    );
    for (const [outletId, days] of byOutlet) {
      if (dropOpen.has(outletId)) continue;
      const drops = scoreDropCauses(outletId, days).filter((drop) => new Date(drop.causedAt) >= since);
      // The latest drop, if several: one is enough to call about.
      const latest = drops[drops.length - 1];
      if (latest) found.push(latest);
    }

    if (found.length > 0) {
      const known = new Set(
        (await this.db.followUp.findMany({ where: { causeKey: { in: found.map((cause) => cause.causeKey) } }, select: { causeKey: true } })).map(
          (row) => row.causeKey,
        ),
      );
      const fresh = found.filter((cause) => !known.has(cause.causeKey));
      if (fresh.length > 0) {
        await this.db.followUp.createMany({
          data: fresh.map((cause) => ({
            outletId: cause.outletId,
            cause: cause.facts.cause,
            causeKey: cause.causeKey,
            jobId: cause.jobId ?? null,
            issueId: cause.issueId ?? null,
            inspectionId: cause.inspectionId ?? null,
            facts: cause.facts as unknown as Prisma.InputJsonValue,
            causedAt: new Date(cause.causedAt),
          })),
          // Two readers at the same moment: the second finds the key taken and skips it.
          skipDuplicates: true,
        });
      }
    }

    // Its free visit finished: the follow-up is done and leaves the queue.
    const booked = await this.db.followUp.findMany({ where: { status: 'OPEN', visitId: { not: null } }, select: { id: true, visitId: true } });
    if (booked.length > 0) {
      const visits = await this.db.job.findMany({
        where: { id: { in: booked.map((row) => row.visitId!) }, status: { in: ['COMPLETED', 'APPROVED'] } },
        select: { id: true, completedAt: true },
      });
      for (const visit of visits) {
        await this.db.followUp.updateMany({
          where: { visitId: visit.id, status: 'OPEN' },
          data: { status: 'DONE', closedAt: visit.completedAt ?? now },
        });
      }
    }
  }

  // ───────────────────────── Reading ─────────────────────────

  /** "open": the queue, what needs the office first. "done": done or closed in the last 30 days, the latest first. */
  async list(state: 'open' | 'done', now: Date): Promise<FollowUpsDto> {
    await this.sweep(now);
    const rows = await this.db.followUp.findMany({
      where:
        state === 'open'
          ? { status: 'OPEN' }
          : { status: { in: ['DONE', 'CLOSED'] }, closedAt: { gte: new Date(now.getTime() - QUALITY_RULES.doneShownDays * DAY_MS) } },
      include: followUpInclude,
      orderBy: state === 'open' ? { causedAt: 'asc' } : { closedAt: 'desc' },
    });
    const [items, callers] = await Promise.all([this.toDtos(rows, now), this.callers()]);
    return { items: state === 'open' ? sortFollowUps(items) : items, callers };
  }

  async get(followUpId: string, now: Date): Promise<FollowUpDto> {
    const row = await this.db.followUp.findUnique({ where: { id: followUpId }, include: followUpInclude });
    if (!row) throw new NotFoundException('Follow-up not found');
    return (await this.toDtos([row], now))[0]!;
  }

  /** The open follow-ups with nothing booked (a free visit cancelled counts as nothing): Today's "Follow-up due". */
  async due(now: Date): Promise<{ id: string; outletName: string; reason: string; causedAt: string }[]> {
    await this.sweep(now);
    const rows = await this.db.followUp.findMany({
      where: { status: 'OPEN' },
      select: { id: true, visitId: true, facts: true, causedAt: true, outlet: { select: { name: true } } },
      orderBy: { causedAt: 'asc' },
    });
    const live = await this.liveVisits(rows.map((row) => row.visitId).filter((id): id is string => id !== null));
    return rows
      .filter((row) => !row.visitId || !live.has(row.visitId))
      .map((row) => ({ id: row.id, outletName: row.outlet.name, reason: followUpReason(row.facts as unknown as FollowUpFacts), causedAt: row.causedAt.toISOString() }));
  }

  /** Open follow-ups, and how many distinct kitchens, for the headline and the badge (counted after a sweep). */
  async openCounts(now: Date): Promise<{ notBooked: number; kitchens: number; open: number }> {
    const due = await this.due(now);
    const open = await this.db.followUp.findMany({ where: { status: 'OPEN' }, select: { outletId: true } });
    return { notBooked: due.length, kitchens: new Set(open.map((row) => row.outletId)).size, open: open.length };
  }

  // ───────────────────────── The buttons ─────────────────────────

  /** Log a call: who called and what was said. */
  async logCall(user: AuthUser, followUpId: string, input: { note: string; calledById?: string | undefined }, now: Date): Promise<FollowUpDto> {
    const row = await this.requireOpen(followUpId);
    const calledById = input.calledById ?? user.id;
    if (calledById !== user.id && !(await this.callers()).some((person) => person.id === calledById)) {
      throw new BadRequestException('Choose someone from ECCS as the person who called');
    }
    await this.db.followUpCall.create({ data: { followUpId: row.id, note: input.note, calledById, loggedById: user.id, at: now } });
    return this.get(row.id, now);
  }

  /**
   * Book a free redo or check-in visit: a normal visit made through the diary's own path (so
   * the Supervisor is told as for any visit), marked free, so it is never invoiced; it changes no
   * score (decision 3). One at a time: another only once the booked one is cancelled.
   */
  async bookVisit(
    user: AuthUser,
    followUpId: string,
    input: { serviceCode: string; date: string; slot: VisitSlot; supervisorId?: string | null | undefined },
    now: Date,
  ): Promise<FollowUpDto> {
    const row = await this.requireOpen(followUpId);
    const earlier = row.visitId ? await this.db.job.findUnique({ where: { id: row.visitId }, select: { status: true } }) : null;
    if (earlier && earlier.status !== 'CANCELLED') throw new ConflictException('A free visit is already booked for this follow-up');

    const visit = await this.services.createVisit(user, { ...input, outletId: row.outletId, free: true });
    // Taken only if nobody booked one in the meantime; otherwise the visit just made is called off again.
    const claimed = await this.db.followUp.updateMany({
      where: { id: row.id, status: 'OPEN', visitId: row.visitId ?? null },
      data: { visitId: visit.id },
    });
    if (claimed.count === 0) {
      await this.services.cancelVisit(user, visit.id);
      throw new ConflictException('A free visit has just been booked for this follow-up');
    }
    return this.get(row.id, now);
  }

  /** Close with a note: how it was settled. It leaves the queue. */
  async close(user: AuthUser, followUpId: string, note: string, now: Date): Promise<FollowUpDto> {
    const row = await this.requireOpen(followUpId);
    const closed = await this.db.followUp.updateMany({
      where: { id: row.id, status: 'OPEN' },
      data: { status: 'CLOSED', closedAt: now, closedById: user.id, closeNote: note },
    });
    if (closed.count === 0) throw new ConflictException('This follow-up has just been closed');
    return this.get(row.id, now);
  }

  // ───────────────────────── The month ─────────────────────────

  /** For the strip: follow-ups in this month (from `start`), done or closed this month, and open now. */
  async monthFacts(start: Date): Promise<{ followUpsIn: number; followUpsClosed: number; followUpsOpen: number }> {
    const [followUpsIn, followUpsClosed, followUpsOpen] = await Promise.all([
      this.db.followUp.count({ where: { createdAt: { gte: start } } }),
      this.db.followUp.count({ where: { status: { in: ['DONE', 'CLOSED'] }, closedAt: { gte: start } } }),
      this.db.followUp.count({ where: { status: 'OPEN' } }),
    ]);
    return { followUpsIn, followUpsClosed, followUpsOpen };
  }

  // ───────────────────────── Helpers ─────────────────────────

  private async requireOpen(followUpId: string) {
    const row = await this.db.followUp.findUnique({ where: { id: followUpId }, select: { id: true, outletId: true, status: true, visitId: true } });
    if (!row) throw new NotFoundException('Follow-up not found');
    if (row.status !== 'OPEN') throw new ConflictException(row.status === 'DONE' ? 'Its free visit is done: this follow-up is finished' : 'This follow-up is closed');
    return row;
  }

  /** Free visits still to happen or under way (not cancelled, not finished). */
  private async liveVisits(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db.job.findMany({ where: { id: { in: ids }, status: { in: ['SCHEDULED', 'ASSIGNED', 'IN_PROGRESS'] } }, select: { id: true } });
    return new Set(rows.map((row) => row.id));
  }

  private async callers(): Promise<{ id: string; name: string }[]> {
    return this.db.user.findMany({
      where: { isActive: true, memberships: { some: { role: { in: [...ECCS_ROLES] } } } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  private async toDtos(rows: FollowUpRow[], now: Date): Promise<FollowUpDto[]> {
    if (rows.length === 0) return [];
    const outletIds = [...new Set(rows.map((row) => row.outletId))];
    const visitIds = rows.map((row) => row.visitId).filter((id): id is string => id !== null);
    const ratedIds = rows.filter((row) => row.cause === 'RATING' && row.jobId).map((row) => row.jobId!);
    const peopleIds = [...new Set(rows.flatMap((row) => [row.closedById, ...row.calls.flatMap((call) => [call.calledById, call.loggedById])]).filter((id): id is string => Boolean(id)))];
    const [scores, visits, rated, people] = await Promise.all([
      this.db.hygieneScoreSnapshot.findMany({ where: { outletId: { in: outletIds } }, select: { outletId: true, score: true }, orderBy: { date: 'desc' }, distinct: ['outletId'] }),
      visitIds.length > 0
        ? this.db.job.findMany({
            where: { id: { in: visitIds } },
            select: { id: true, scheduledDate: true, scheduledSlot: true, status: true, reviewedAt: true, serviceType: { select: { name: true } }, supervisor: { select: { name: true } } },
          })
        : Promise.resolve([]),
      ratedIds.length > 0 ? this.db.job.findMany({ where: { id: { in: ratedIds } }, select: { id: true, serviceType: { select: { code: true, isActive: true } } } }) : Promise.resolve([]),
      peopleIds.length > 0 ? this.db.user.findMany({ where: { id: { in: peopleIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    ]);
    const scoreBy = new Map(scores.map((row) => [row.outletId, Math.round(row.score)]));
    const visitBy = new Map(visits.map((visit) => [visit.id, visit]));
    const ratedBy = new Map(rated.map((job) => [job.id, job]));
    const nameOf = (id: string | null) => (id ? (people.find((person) => person.id === id)?.name ?? 'someone who has left') : null);

    return rows.map((row): FollowUpDto => {
      const facts = row.facts as unknown as FollowUpFacts;
      const visitRow = row.visitId ? visitBy.get(row.visitId) : undefined;
      const visit = visitRow
        ? {
            id: visitRow.id,
            date: fromDbDate(visitRow.scheduledDate),
            slot: toSlot(visitRow.scheduledSlot),
            status: (visitRow.status === 'APPROVED' && !visitRow.reviewedAt ? 'IN_REVIEW' : visitRow.status) as VisitStatus,
            serviceName: visitRow.serviceType.name as LocalizedText,
            supervisorName: visitRow.supervisor?.name ?? null,
          }
        : null;
      const { standing, words } = followUpStanding(row.status as FollowUpStatus, visit);
      const latest = row.calls[0];
      const ratedJob = row.jobId ? ratedBy.get(row.jobId) : undefined;
      return {
        id: row.id,
        outletId: row.outletId,
        outletName: row.outlet.name,
        area: row.outlet.area,
        score: scoreBy.get(row.outletId) ?? null,
        cause: row.cause as FollowUpCause,
        reason: followUpReason(facts),
        source: sourceOf(row),
        causedAt: row.causedAt.toISOString(),
        sinceDays: daysSince(row.causedAt.toISOString(), now),
        status: row.status as FollowUpStatus,
        standing,
        standingWords: words,
        told: latest ? `${nameOf(latest.calledById)}: ${latest.note}` : null,
        calls: row.calls.map((call) => ({
          id: call.id,
          note: call.note,
          calledByName: nameOf(call.calledById)!,
          loggedByName: nameOf(call.loggedById)!,
          at: call.at.toISOString(),
        })),
        visit,
        suggestedService: ratedJob?.serviceType.isActive ? ratedJob.serviceType.code : null,
        closedAt: row.closedAt?.toISOString() ?? null,
        closedByName: nameOf(row.closedById),
        closeNote: row.closeNote,
      };
    });
  }
}

/** Where the cause can be seen: the rated visit, the issue, the inspection, or the outlet's row on Health. */
function sourceOf(row: Pick<FollowUpRow, 'cause' | 'jobId' | 'issueId' | 'inspectionId' | 'outletId'>): FollowUpSource {
  if (row.cause === 'RATING' && row.jobId) return { kind: 'VISIT', visitId: row.jobId };
  if (row.cause === 'ISSUE_REOPENED' && row.issueId) return { kind: 'ISSUE', issueId: row.issueId };
  if (row.cause === 'INSPECTION' && row.inspectionId) return { kind: 'INSPECTION', inspectionId: row.inspectionId };
  return { kind: 'HEALTH', outletId: row.outletId };
}
