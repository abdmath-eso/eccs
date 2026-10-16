import { Injectable } from '@nestjs/common';
import {
  addDays,
  closeTitle,
  closeWords,
  conversionRates,
  daysFrom,
  forecastEnd,
  indiaDay,
  isReferral,
  LEAD_SOURCES,
  LEAD_STAGES,
  likelyToClose,
  monthlyPaise,
  nextWeekForecast,
  paceForecast,
  SALES_RULES,
  targetStatus,
  TARGET_FIGURES,
  weeklyTargets,
  weekNumber,
  weekStartOf,
  type BdeDayDto,
  type BdeWeekDto,
  type BillingCycle,
  type LeadSource,
  type LeadStage,
  type SalesOverviewDto,
  type TargetFigure,
  type TargetFigures,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { indiaDate } from '../checklists/checklists.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { latestPlanQuote, latestSent, type LeadRow } from './sales-facts.service.js';
import { SalesService } from './sales.service.js';

// The Sales page's figures (15 Oct 2026), to the founder's design: the four cards with
// their last four weeks, where the leads are, Do today, Likely to close, this week by
// BDE against their targets, growth week by week with the forecast to 31 December, and
// where this month's first jobs came from.
//
// Leads, steps and sales come from the leads. Paying kitchens and people on the app come
// from the app itself: an outlet counts as paying from its first approved visit, paid
// invoice or plan; a person counts as using the app in a week when a restaurant login of
// theirs was used in it. A won lead not linked to any client (only sample leads, since a
// real lead is won only through its client) adds its own kitchens.

const toDb = (date: string) => new Date(`${date}T00:00:00.000Z`);
const within = (date: string, from: string, to: string) => date >= from && date <= to;
const sum = <T>(items: readonly T[], pick: (item: T) => number) => items.reduce((total, item) => total + pick(item), 0);
const RESTAURANT_ROLES = ['OWNER', 'MANAGER', 'HEAD_CHEF'] as const;

/** One person's leads logged, free checks done, first jobs and plans won between two India dates. */
function weekFigures(list: readonly LeadRow[], from: string, to: string): TargetFigures {
  const day = (at: Date) => indiaDay(at);
  return {
    leads: list.filter((row) => within(day(row.createdAt), from, to)).length,
    checks: sum(list, (row) => row.activities.filter((entry) => entry.kind === 'CHECK_DONE' && within(day(entry.at), from, to)).length),
    firstJobs: list.filter((row) => row.wonAt && within(day(row.wonAt), from, to)).length,
    plans: list.filter((row) => row.planAt && within(day(row.planAt), from, to)).length,
  };
}

/**
 * One BDE's week against their targets: this week so far, last week, and the targets set
 * every Monday from the last two weeks (or by the Super Admin). The Sales page's "This
 * week, by BDE" and the BDE's own Home on the phone both use this, so they always agree.
 */
function bdeWeek(
  person: { id: string; name: string },
  mine: readonly LeadRow[],
  floors: TargetFigures,
  set: { leads: number | null; checks: number | null; firstJobs: number | null; plans: number | null } | null,
  today: string,
): BdeWeekDto {
  const weekStart = weekStartOf(today);
  const lastWeekStart = addDays(weekStart, -7);
  const weekBeforeStart = addDays(weekStart, -14);
  const lastWeek = weekFigures(mine, lastWeekStart, addDays(lastWeekStart, 6));
  const weekBefore = weekFigures(mine, weekBeforeStart, addDays(weekBeforeStart, 6));
  const actual = weekFigures(mine, weekStart, today);
  const manual: Partial<Record<TargetFigure, number | null>> = set ? { leads: set.leads, checks: set.checks, firstJobs: set.firstJobs, plans: set.plans } : {};
  const targets = weeklyTargets(lastWeek, weekBefore, floors, manual);
  const status = targetStatus(actual, targets, today);
  return {
    userId: person.id,
    name: person.name,
    actual,
    targets,
    overridden: TARGET_FIGURES.filter((figure) => typeof manual[figure] === 'number'),
    status: status.status,
    missed: status.missed,
    lastWeek,
  };
}

@Injectable()
export class SalesOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  async overview(user: AuthUser, query: { owner?: string }): Promise<SalesOverviewDto> {
    const scope = this.sales.scope(user);
    const owner = scope === 'own' ? user.id : (query.owner ?? null);
    const now = new Date();
    const today = indiaDate(now);
    const weekStart = weekStartOf(today);
    const monthStart = `${today.slice(0, 7)}-01`;
    const weekEnd = (start: string) => {
      const end = addDays(start, 6);
      return end < today ? end : today;
    };

    const [{ rows, facts }, owners, samples, firstLead, floors, overrides, plansOffered] = await Promise.all([
      this.sales.loaded(owner ? { ownerId: owner } : {}),
      this.sales.owners(),
      this.db.lead.count({ where: { isSample: true } }),
      this.db.lead.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
      this.sales.floors(),
      this.db.salesTarget.findMany({ where: { weekStart: toDb(weekStart) } }),
      this.db.plan.findMany({ where: { isActive: true }, select: { pricePaise: true, billingCycle: true } }),
    ]);

    const day = (at: Date) => indiaDay(at);
    const salesStart = firstLead ? weekStartOf(day(firstLead.createdAt)) : weekStart;
    const firstShown = [salesStart, addDays(weekStart, -7 * (SALES_RULES.growthWeeksShown - 1))].sort().at(-1)!;
    const weeks: string[] = [];
    for (let start = firstShown; start <= weekStart; start = addDays(start, 7)) weeks.push(start);
    const lastFour = [-3, -2, -1, 0].map((offset) => addDays(weekStart, 7 * offset));

    // ── What happened when, from the leads ──
    const created = (from: string, to: string) => rows.filter((row) => within(day(row.createdAt), from, to));
    const won = rows.flatMap((row) => row.activities.filter((entry) => entry.kind === 'WON').map((entry) => ({ row, ...entry })));
    const wonValue = (from: string, to: string) => sum(won.filter((entry) => within(day(entry.at), from, to)), (entry) => entry.amountPaise ?? 0);
    const firstJobs = (from: string, to: string, list: readonly LeadRow[] = rows) => list.filter((row) => row.wonAt && within(day(row.wonAt), from, to)).length;
    const plansWon = (from: string, to: string, list: readonly LeadRow[] = rows) => list.filter((row) => row.planAt && within(day(row.planAt), from, to)).length;
    // A client counts once, in the week its first lead was won.
    const firstWin = new Map<string, string>();
    for (const row of rows) {
      if (!row.wonAt) continue;
      const key = row.organizationId ?? row.id;
      const date = day(row.wonAt);
      if (!firstWin.has(key) || date < firstWin.get(key)!) firstWin.set(key, date);
    }
    const newCustomers = (from: string, to: string) => [...firstWin.values()].filter((date) => within(date, from, to)).length;

    // ── Paying kitchens and people on the app, from the app ──
    const scoped = owner ? [...new Set(rows.filter((row) => row.wonAt && row.organizationId).map((row) => row.organizationId!))] : null;
    const app = await this.appCustomers(scoped);
    const unlinked = rows.filter((row) => !row.organizationId && row.wonAt && row.status !== 'LOST');
    const kitchensOf = (row: LeadRow, date: string) => (row.planAt && day(row.planAt) <= date ? (latestPlanQuote(row.quotes)?.line.quantity ?? 1) : 1);
    const payingKitchens = (date: string) =>
      [...app.outletFirstPaid.values()].filter((first) => first <= date).length + sum(unlinked.filter((row) => day(row.wonAt!) <= date), (row) => kitchensOf(row, date));
    const people = (date: string) => {
      const from = addDays(date, -6);
      return new Set(app.sessions.filter((session) => session.from <= date && session.to >= from).map((session) => session.userId)).size;
    };

    // ── The three rates, now and at the end of each of the last four weeks ──
    const ratesAt = (date: string) =>
      conversionRates(
        rows
          .filter((row) => day(row.createdAt) <= date)
          .map((row) => ({
            won: Boolean(row.wonAt && day(row.wonAt) <= date),
            checked: Boolean(row.checkDoneAt && day(row.checkDoneAt) <= date),
            quoted: row.quotes.some((quote) => quote.status === 'SENT' && quote.sentAt && day(quote.sentAt) <= date),
          })),
      );
    const rates = ratesAt(today);

    // ── Where the leads are ──
    const open = rows.filter((row) => row.status === 'OPEN');
    const counts = Object.fromEntries(LEAD_STAGES.map((stage) => [stage, open.filter((row) => row.stage === stage).length])) as Record<LeadStage, number>;
    const openQuoted = open.filter((row) => row.stage === 'QUOTED');
    const quotedPaise = sum(openQuoted, (row) => latestSent(row.quotes)?.subtotalPaise ?? 0);

    // ── This week, by BDE ──
    const byBde: BdeWeekDto[] = owners
      .filter((person) => person.isBde && (!owner || person.id === owner))
      .map((person) => bdeWeek(person, rows.filter((row) => row.ownerId === person.id), floors, overrides.find((row) => row.userId === person.id) ?? null, today));

    // ── Growth and the forecasts ──
    const end = forecastEnd(today);
    const weeksAhead = daysFrom(today, end) / 7;
    const twoWeeksAgo = addDays(today, -14);
    const firstJobValues = won.filter((entry) => entry.toStage === 'FIRST_JOB' || (entry.toStage === null && entry.rating !== null)).map((entry) => entry.amountPaise ?? 0);
    const checksDoneOpen = open.filter((row) => row.stage === 'CHECK_DONE').length;
    const openQuotesPaise = quotedPaise;
    const nextWeekPaise = nextWeekForecast({
      lastWeekPaise: wonValue(addDays(weekStart, -7), addDays(weekStart, -1)),
      weekBeforePaise: wonValue(addDays(weekStart, -14), addDays(weekStart, -8)),
      openQuotesPaise,
      quoteToWinPercent: rates.quoteToWin,
      checksDone: checksDoneOpen,
      checkToPaidPercent: rates.checkToPaid,
      averageSalePaise: firstJobValues.length > 0 ? Math.round(sum(firstJobValues, (value) => value) / firstJobValues.length) : 0,
    });

    // Plans that repeat: the app's active plans, and won sample leads on a plan.
    const unlinkedPlans = unlinked.filter((row) => row.stage === 'ON_PLAN').map((row) => latestPlanQuote(row.quotes));
    const monthlyPlans =
      sum(app.plans, (plan) => monthlyPaise(plan.pricePaise, plan.cycle)) +
      sum(unlinkedPlans, (plan) => (plan ? monthlyPaise(plan.line.amountPaise, (plan.line.cycle ?? 'MONTHLY') as BillingCycle) : 0));
    const prices = [...new Set(plansOffered.map((plan) => monthlyPaise(plan.pricePaise, plan.billingCycle as BillingCycle)))].sort((a, b) => a - b);

    // ── Where this month's first jobs came from ──
    const thisMonth = rows.filter((row) => row.wonAt && day(row.wonAt) >= monthStart);
    const bySource = new Map<LeadSource, number>();
    for (const row of thisMonth) bySource.set(row.source as LeadSource, (bySource.get(row.source as LeadSource) ?? 0) + 1);

    const doToday = this.sales.toDoList(rows, facts, now);
    const names = new Map(rows.map((row) => [row.id, row.owner.name]));

    return {
      today,
      weekStart,
      weekNumber: weekNumber(salesStart, today),
      sample: samples > 0,
      owner,
      owners: scope === 'all' ? owners : owners.filter((person) => person.id === user.id),
      headline: { firstJobs: firstJobs(weekStart, today), plans: plansWon(weekStart, today), toDo: doToday.length },
      cards: {
        leads: {
          week: created(weekStart, today).length,
          month: created(monthStart, today).length,
          referrals: created(monthStart, today).filter((row) => isReferral(row.source as LeadSource)).length,
          spark: lastFour.map((start) => created(start, weekEnd(start)).length),
        },
        won: {
          weekPaise: wonValue(weekStart, today),
          firstJobs: firstJobs(weekStart, today),
          plans: plansWon(weekStart, today),
          monthPaise: wonValue(monthStart, today),
          spark: lastFour.map((start) => wonValue(start, weekEnd(start))),
        },
        customers: {
          week: newCustomers(weekStart, today),
          payingKitchens: payingKitchens(today),
          people: people(today),
          spark: lastFour.map((start) => newCustomers(start, weekEnd(start))),
        },
        conversion: { ...rates, spark: lastFour.map((start) => ratesAt(weekEnd(start)).checkToPaid) },
      },
      stages: {
        counts,
        quotedPaise,
        open: open.length,
        parked: rows.filter((row) => row.status === 'PARKED').length,
        lostThisMonth: rows.filter((row) => row.status === 'LOST' && row.lostAt && day(row.lostAt) >= monthStart).length,
      },
      doToday,
      likely: likelyToClose([...facts.values()], now).map(({ lead, score }) => ({
        leadId: lead.id,
        title: closeTitle(lead, score.kind),
        kind: score.kind,
        score: score.score,
        signals: closeWords(score),
        ownerName: names.get(lead.id) ?? '',
      })),
      byBde,
      floors,
      growth: {
        weeks: weeks.map((start) => {
          const last = weekEnd(start);
          return {
            label: `Week ${weekNumber(salesStart, start)}`,
            start,
            end: last,
            payingKitchens: payingKitchens(last),
            people: people(last),
            wonPaise: wonValue(start, last),
            current: start === weekStart,
          };
        }),
        forecastDate: end,
        forecast: {
          payingKitchens: paceForecast(payingKitchens(today), payingKitchens(twoWeeksAgo), weeksAhead),
          people: paceForecast(people(today), people(twoWeeksAgo), weeksAhead),
        },
        nextWeekPaise,
        monthWonPaise: wonValue(monthStart, today),
        pipeline: { openQuotes: openQuoted.length, openQuotesPaise, checksDone: checksDoneOpen },
        plans: { count: app.plans.length + unlinkedPlans.length, monthlyPaise: monthlyPlans, prices },
      },
      // Most first; equal counts in the usual order of sources (field visits first).
      sources: [...bySource.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count || LEAD_SOURCES.indexOf(a.source) - LEAD_SOURCES.indexOf(b.source)),
      firstJobsThisMonth: thisMonth.length,
    };
  }

  /**
   * A BDE's day on the phone (B2): Do today for their own leads only, and this week's
   * leads, free checks, first jobs and plans against their targets, worked out exactly as
   * the Sales page's "This week, by BDE" (bdeWeek below). One request for the Home screen.
   */
  async day(user: AuthUser): Promise<BdeDayDto> {
    this.sales.scope(user);
    const now = new Date();
    const today = indiaDate(now);
    const [{ rows, facts }, floors, override, me] = await Promise.all([
      this.sales.loaded({ ownerId: user.id }),
      this.sales.floors(),
      this.db.salesTarget.findUnique({ where: { userId_weekStart: { userId: user.id, weekStart: toDb(weekStartOf(today)) } } }),
      this.db.user.findUnique({ where: { id: user.id }, select: { name: true } }),
    ]);
    const isBde = user.memberships.some((membership) => membership.role === 'BDE');
    return {
      today,
      items: this.sales.toDoList(rows, facts, now),
      week: isBde ? bdeWeek({ id: user.id, name: me?.name ?? '' }, rows, floors, override, today) : null,
    };
  }

  /**
   * This week against target for each of these BDEs, worked out by the same bdeWeek as the
   * Sales page's "This week, by BDE", for the Team page (16 Oct 2026). `rows` are their
   * leads, every status, when the caller has them loaded already.
   */
  async weeks(people: readonly { id: string; name: string }[], rows?: readonly LeadRow[]): Promise<Map<string, BdeWeekDto>> {
    if (people.length === 0) return new Map();
    const today = indiaDate();
    const ids = people.map((person) => person.id);
    const [leads, floors, overrides] = await Promise.all([
      rows ? Promise.resolve(rows) : this.sales.loaded({ ownerId: { in: ids } }).then((loaded) => loaded.rows),
      this.sales.floors(),
      this.db.salesTarget.findMany({ where: { weekStart: toDb(weekStartOf(today)), userId: { in: ids } } }),
    ]);
    return new Map(
      people.map((person) => [person.id, bdeWeek(person, leads.filter((row) => row.ownerId === person.id), floors, overrides.find((row) => row.userId === person.id) ?? null, today)]),
    );
  }

  /**
   * From the app: when each outlet first paid (its first approved visit, paid invoice or
   * plan), the restaurant logins' sessions (when each was first and last used), and the
   * plans running now. Narrowed to some clients when the page is narrowed to one BDE.
   */
  private async appCustomers(organizationIds: string[] | null) {
    const orgs = organizationIds ? { id: { in: organizationIds }, isActive: true } : { isActive: true };
    const [jobs, payments, subscriptions, sessions] = await Promise.all([
      this.db.job.findMany({ where: { status: 'APPROVED', outlet: { organization: orgs } }, select: { outletId: true, approvedAt: true, completedAt: true, scheduledDate: true } }),
      this.db.payment.findMany({
        where: { status: 'SUCCEEDED', paidAt: { not: null }, invoice: { outletId: { not: null }, organization: orgs } },
        select: { paidAt: true, invoice: { select: { outletId: true } } },
      }),
      this.db.subscription.findMany({
        where: { outlet: { organization: orgs } },
        select: { outletId: true, startDate: true, status: true, pricePaise: true, billingCycle: true, plan: { select: { pricePaise: true, billingCycle: true } } },
      }),
      this.db.session.findMany({
        where: {
          user: {
            memberships: {
              some: {
                role: { in: [...RESTAURANT_ROLES] },
                ...(organizationIds && { OR: [{ organizationId: { in: organizationIds } }, { outlet: { organizationId: { in: organizationIds } } }] }),
              },
            },
          },
        },
        select: { userId: true, createdAt: true, lastUsedAt: true },
      }),
    ]);
    const outletFirstPaid = new Map<string, string>();
    const paid = (outletId: string, date: string) => {
      const known = outletFirstPaid.get(outletId);
      if (!known || date < known) outletFirstPaid.set(outletId, date);
    };
    for (const job of jobs) paid(job.outletId, indiaDay(job.approvedAt ?? job.completedAt ?? job.scheduledDate));
    for (const payment of payments) paid(payment.invoice.outletId!, indiaDay(payment.paidAt!));
    for (const subscription of subscriptions) paid(subscription.outletId, subscription.startDate.toISOString().slice(0, 10));
    return {
      outletFirstPaid,
      sessions: sessions.map((session) => ({ userId: session.userId, from: indiaDay(session.createdAt), to: indiaDay(session.lastUsedAt) })),
      plans: subscriptions
        .filter((subscription) => subscription.status === 'ACTIVE')
        .map((subscription) => ({
          pricePaise: subscription.pricePaise ?? subscription.plan.pricePaise,
          cycle: (subscription.billingCycle ?? subscription.plan.billingCycle) as BillingCycle,
        })),
    };
  }
}
