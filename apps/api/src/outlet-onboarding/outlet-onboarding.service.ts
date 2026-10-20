import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  addDays,
  callsDue,
  hoursBetween,
  indiaDay,
  isLive,
  isStuck,
  liveAt,
  localize,
  onboardingDay,
  onboardingSteps,
  onboardingStrip,
  onNewOutletsTab,
  OUTLET_ONBOARDING_RULES,
  pendingDocuments,
  sortOnboardingCards,
  type LocalizedText,
  type OnboardingEntryKind,
  type OnboardingFacts,
  type OutletOnboardingAttentionDto,
  type OutletOnboardingBoardDto,
  type OutletOnboardingCardDto,
  type Role,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

// New outlets (20 Oct 2026; Clients > New outlets): each outlet's first ten days. Steps 1 to 6
// are read live from what the apps already record, each time the tab is opened, so they can
// never disagree with the records; only the one-tap entries are stored (OutletOnboardingEntry).
// Rules: packages/shared/src/outlet-onboarding.ts.

const DAY_MS = 86_400_000;
/** An onboarding started together with its outlet: "added by" is whoever started it. */
const SAME_MOMENT_MS = 60_000;
/** Far enough back for the strip: this month, and outlets whose day 10 came in the last 30 days. */
const LOOK_BACK_DAYS = 45;

type OnboardingRow = Awaited<ReturnType<OutletOnboardingService['rows']>>[number];

@Injectable()
export class OutletOnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  private rows(since: Date) {
    return this.db.outletOnboarding.findMany({
      where: { outlet: { createdAt: { gte: since } } },
      include: {
        entries: { orderBy: { at: 'desc' } },
        outlet: {
          select: {
            id: true,
            name: true,
            code: true,
            area: true,
            createdAt: true,
            organizationId: true,
            organization: { select: { name: true } },
          },
        },
      },
    });
  }

  /** The New outlets tab: the cards, the strip above them, and the outlets that could still be started. */
  async board(now = new Date()): Promise<OutletOnboardingBoardDto> {
    const rows = await this.rows(new Date(now.getTime() - LOOK_BACK_DAYS * DAY_MS));
    const cards = await Promise.all(rows.map((row) => this.card(row, now)));
    const strip = onboardingStrip(
      await Promise.all(
        cards.map(async (card) => {
          const firstChecklist = card.steps.find((step) => step.key === 'FIRST_CHECKLIST');
          return {
            addedAt: card.addedAt,
            liveAt: liveAt(card.steps),
            firstChecklistAt: firstChecklist?.done ? firstChecklist.at : null,
            checklistDays: await this.checklistDays(card.outletId, card.addedAt),
          };
        }),
      ),
      now,
    );

    const tenDaysAgo = new Date(`${addDays(indiaDay(now), -OUTLET_ONBOARDING_RULES.days)}T00:00:00.000+05:30`);
    const unstarted = await this.db.outlet.findMany({
      where: { createdAt: { gte: tenDaysAgo }, onboarding: null, isActive: true, organization: { isActive: true } },
      select: { id: true, name: true, createdAt: true, organization: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return {
      today: indiaDay(now),
      cards: sortOnboardingCards(cards.filter((card) => onNewOutletsTab(card.addedAt, now))),
      strip,
      toStart: unstarted
        .filter((outlet) => onNewOutletsTab(outlet.createdAt.toISOString(), now))
        .map((outlet) => ({ outletId: outlet.id, outletName: outlet.name, organizationName: outlet.organization.name, addedAt: outlet.createdAt.toISOString() })),
    };
  }

  /** For the Today page (step 2 of the console plan): outlets stuck past 24 hours, and the day-3 and day-10 calls due. */
  async attention(now = new Date()): Promise<OutletOnboardingAttentionDto> {
    const since = new Date(now.getTime() - (OUTLET_ONBOARDING_RULES.days + OUTLET_ONBOARDING_RULES.callLateDays + 1) * DAY_MS);
    const cards = await Promise.all((await this.rows(since)).map((row) => this.card(row, now)));
    const place = (card: OutletOnboardingCardDto) => ({ outletId: card.outletId, outletName: card.outletName, organizationName: card.organizationName });
    return {
      stuck: cards
        .filter((card) => card.stuck && onNewOutletsTab(card.addedAt, now))
        .sort((a, b) => a.addedAt.localeCompare(b.addedAt))
        .map((card) => ({ ...place(card), hoursSinceAdded: card.hoursSinceAdded })),
      calls: cards
        .flatMap((card) => callsDue(card.steps, now).map((call) => ({ ...place(card), ...call })))
        .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.outletName.localeCompare(b.outletName)),
    };
  }

  /** "Start onboarding" for an outlet added before onboarding started by itself, while it is under ten days old. */
  async start(user: AuthUser, outletId: string, now = new Date()): Promise<OutletOnboardingBoardDto> {
    const outlet = await this.db.outlet.findUnique({ where: { id: outletId }, select: { id: true, createdAt: true, onboarding: { select: { id: true } } } });
    if (!outlet) throw new NotFoundException('Outlet not found');
    if (outlet.onboarding) throw new ConflictException('This outlet is already being onboarded');
    if (!onNewOutletsTab(outlet.createdAt.toISOString(), now)) {
      throw new ConflictException(`Onboarding is for an outlet's first ${OUTLET_ONBOARDING_RULES.days} days; this one is older`);
    }
    await this.db.outletOnboarding.create({ data: { outletId: outlet.id, startedAt: now, startedById: user.id } });
    return this.board(now);
  }

  /** One tap: the day-3 call, the posters delivered, the day-10 call, or a note. */
  async log(user: AuthUser, outletId: string, input: { kind: OnboardingEntryKind; note?: string | undefined }): Promise<OutletOnboardingCardDto> {
    const onboarding = await this.requireOnboarding(outletId);
    const note = input.note?.trim() || null;
    await this.db.outletOnboardingEntry.create({ data: { onboardingId: onboarding.id, kind: input.kind, note, byId: user.id } });
    return this.cardFor(outletId);
  }

  /** Takes back an entry made by mistake (for the posters, "not delivered after all"). */
  async remove(outletId: string, entryId: string): Promise<OutletOnboardingCardDto> {
    const onboarding = await this.requireOnboarding(outletId);
    const deleted = await this.db.outletOnboardingEntry.deleteMany({ where: { id: entryId, onboardingId: onboarding.id } });
    if (deleted.count === 0) throw new NotFoundException('Not found');
    return this.cardFor(outletId);
  }

  private async requireOnboarding(outletId: string) {
    const onboarding = await this.db.outletOnboarding.findUnique({ where: { outletId }, select: { id: true } });
    if (!onboarding) throw new NotFoundException('This outlet is not being onboarded');
    return onboarding;
  }

  private async cardFor(outletId: string): Promise<OutletOnboardingCardDto> {
    const row = await this.db.outletOnboarding.findUniqueOrThrow({
      where: { outletId },
      include: {
        entries: { orderBy: { at: 'desc' } },
        outlet: { select: { id: true, name: true, code: true, area: true, createdAt: true, organizationId: true, organization: { select: { name: true } } } },
      },
    });
    return this.card(row, new Date());
  }

  // ───────────────────────── Reading the facts ─────────────────────────

  private async card(row: OnboardingRow, now: Date): Promise<OutletOnboardingCardDto> {
    const facts = await this.facts(row);
    const steps = onboardingSteps(facts);
    const addedAt = facts.addedAt;
    const went = liveAt(steps);
    const [owner, lead, plan] = await Promise.all([
      this.db.membership.findFirst({
        where: { role: 'OWNER', organizationId: row.outlet.organizationId, user: { isActive: true } },
        orderBy: { createdAt: 'asc' },
        select: { user: { select: { name: true, phone: true } } },
      }),
      this.db.lead.findFirst({
        where: { organizationId: row.outlet.organizationId },
        orderBy: { createdAt: 'asc' },
        // Linked when the client is onboarded from the lead; "won" is the day it became a client if no first job is recorded yet.
        select: { wonAt: true, owner: { select: { name: true } } },
      }),
      this.db.subscription.findFirst({
        where: { outletId: row.outlet.id, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        select: { plan: { select: { name: true } } },
      }),
    ]);
    const names = await this.names(row.entries.map((entry) => entry.byId));
    return {
      outletId: row.outlet.id,
      outletName: row.outlet.name,
      organizationName: row.outlet.organization.name,
      area: row.outlet.area,
      addedAt,
      day: onboardingDay(addedAt, now),
      wonBy: lead ? { name: lead.owner.name, on: indiaDay(lead.wonAt ?? addedAt) } : null,
      planName: plan ? localize(plan.plan.name as LocalizedText, 'EN') || null : null,
      steps,
      stepsDone: steps.filter((step) => step.done).length,
      live: isLive(steps),
      liveAfterHours: went ? hoursBetween(addedAt, went) : null,
      hoursSinceAdded: hoursBetween(addedAt, now),
      stuck: isStuck(steps, addedAt, now),
      owner: owner ? { name: owner.user.name, phone: owner.user.phone } : null,
      notes: row.entries
        .filter((entry) => entry.kind === 'NOTE')
        .map((entry) => ({ id: entry.id, note: entry.note, at: entry.at.toISOString(), by: entry.byId ? (names.get(entry.byId) ?? null) : null })),
    };
  }

  /** What the apps have recorded for one outlet, gathered for the rules in packages/shared. */
  private async facts(row: OnboardingRow): Promise<OnboardingFacts> {
    const outlet = row.outlet;
    const addedAt = outlet.createdAt.toISOString();

    const [owners, staff, licences, firstChecklist] = await Promise.all([
      this.db.membership.findMany({
        where: { role: 'OWNER', organizationId: outlet.organizationId, user: { isActive: true } },
        orderBy: { createdAt: 'asc' },
        select: { userId: true, user: { select: { pinLookup: true } } },
      }),
      this.db.membership.findMany({
        where: { outletId: outlet.id, role: { in: ['MANAGER', 'HEAD_CHEF'] }, user: { isActive: true } },
        select: { userId: true, role: true, createdAt: true, user: { select: { pinLookup: true } } },
      }),
      this.db.licence.findMany({
        where: { outletId: outlet.id },
        select: { type: true, document: { select: { createdAt: true, uploadedById: true } } },
      }),
      // "With photos": handed in, with at least one proof photo on one of its answers.
      this.db.checklistRun.findFirst({
        where: { outletId: outlet.id, status: 'SUBMITTED', submittedAt: { not: null }, responses: { some: { attachments: { some: { kind: 'PROOF' } } } } },
        orderBy: { submittedAt: 'asc' },
        select: { submittedAt: true, submittedById: true, outletChecklist: { select: { template: { select: { title: true } } } } },
      }),
    ]);

    // Step 2: the first Owner; their first login is their first session (sessions are only ever revoked, never removed).
    const owner = owners[0];
    const firstSession = owner
      ? await this.db.session.findFirst({ where: { userId: owner.userId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } })
      : null;

    // Step 4: everyone who must agree for this outlet, each with the roles they hold here.
    const people = new Map<string, Role[]>();
    for (const membership of owners) people.set(membership.userId, ['OWNER']);
    for (const membership of staff) people.set(membership.userId, [...(people.get(membership.userId) ?? []), membership.role as Role]);
    const acceptances = await this.db.legalAcceptance.findMany({
      where: { userId: { in: [...people.keys()] } },
      select: { userId: true, documentKey: true, version: true, acceptedAt: true },
    });

    const addedBy = await this.addedBy(row);
    const names = await this.names([
      ...licences.map((licence) => licence.document?.uploadedById ?? null),
      firstChecklist?.submittedById ?? null,
      ...row.entries.map((entry) => entry.byId),
    ]);
    const nameOf = (id: string | null | undefined) => (id ? (names.get(id) ?? null) : null);

    return {
      addedAt,
      code: outlet.code,
      addedBy,
      owner: owner ? { firstLoginAt: firstSession?.createdAt.toISOString() ?? null, hasPin: owner.user.pinLookup !== null } : null,
      staffWithPin: staff
        .filter((membership) => membership.user.pinLookup !== null)
        .map((membership) => ({ role: membership.role as 'MANAGER' | 'HEAD_CHEF', at: membership.createdAt.toISOString() })),
      people: [...people].map(([userId, roles]) => {
        const theirs = acceptances.filter((acceptance) => acceptance.userId === userId);
        const pending = pendingDocuments(roles, theirs.map((acceptance) => ({ key: acceptance.documentKey, version: acceptance.version })));
        const latest = theirs.reduce<Date | null>((most, acceptance) => (!most || acceptance.acceptedAt > most ? acceptance.acceptedAt : most), null);
        return { agreedAt: pending.length === 0 && latest ? latest.toISOString() : null };
      }),
      licences: licences.map((licence) => ({
        type: licence.type,
        copyAt: licence.document?.createdAt.toISOString() ?? null,
        copyBy: nameOf(licence.document?.uploadedById),
      })),
      firstChecklist: firstChecklist?.submittedAt
        ? {
            at: firstChecklist.submittedAt.toISOString(),
            by: nameOf(firstChecklist.submittedById),
            name: localize(firstChecklist.outletChecklist.template.title as LocalizedText, 'EN') || null,
          }
        : null,
      entries: row.entries.map((entry) => ({
        id: entry.id,
        kind: entry.kind as OnboardingEntryKind,
        note: entry.note,
        at: entry.at.toISOString(),
        by: nameOf(entry.byId),
      })),
    };
  }

  /**
   * Who added the outlet: whoever started an onboarding that began with it; else the
   * activity log's row for adding the client or the outlet.
   */
  private async addedBy(row: OnboardingRow): Promise<string | null> {
    if (row.startedById && Math.abs(row.startedAt.getTime() - row.outlet.createdAt.getTime()) < SAME_MOMENT_MS) {
      return (await this.names([row.startedById])).get(row.startedById) ?? null;
    }
    const logged = await this.db.activityLog.findFirst({
      where: {
        result: 'SUCCESS',
        OR: [
          { action: 'clients.outlet.added', entityId: row.outlet.id },
          { action: 'clients.client.added', entityId: row.outlet.organizationId },
        ],
      },
      orderBy: { at: 'asc' },
      select: { actorName: true },
    });
    return logged?.actorName ?? null;
  }

  /** The India days with a checklist handed in, from the day the outlet was added to its day 10 (for "still using"). */
  private async checklistDays(outletId: string, addedAt: string): Promise<string[]> {
    const first = indiaDay(addedAt);
    const last = addDays(first, OUTLET_ONBOARDING_RULES.days);
    const runs = await this.db.checklistRun.findMany({
      where: { outletId, status: 'SUBMITTED', date: { gte: new Date(`${first}T00:00:00.000Z`), lte: new Date(`${last}T00:00:00.000Z`) } },
      select: { date: true },
    });
    return runs.map((run) => run.date.toISOString().slice(0, 10));
  }

  private async names(ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (wanted.length === 0) return new Map();
    const people = await this.db.user.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } });
    return new Map(people.map((person) => [person.id, person.name]));
  }
}
