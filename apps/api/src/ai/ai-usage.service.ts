import { Injectable } from '@nestjs/common';
import { Prisma } from '@eccs/db';
import {
  addDays,
  AI_ECCS_OWN_FEATURES,
  AI_FEATURES,
  AI_HELPER_ORDER,
  AI_LIMIT_LABELS,
  AI_OUTCOME_LABELS,
  AI_RESULT_LABELS,
  AI_RESULTS,
  AI_SOURCE_LABELS,
  AI_SOURCES,
  AI_STOPPED_ON_PURPOSE,
  AI_USAGE_RULES,
  aiFindings,
  aiModelName,
  aiResultOf,
  aiUsageRange,
  aiWarnings,
  creditLeft,
  dayCount,
  daysInMonth,
  indiaMidnightOf,
  localize,
  mainRole,
  monthForecast,
  quietWeekday,
  ROLE_LABELS,
  shareOfPay,
  statusesOf,
  AI_HELPERS,
  type AiAlertsDto,
  type AiDayDto,
  type AiFacetOptionDto,
  type AiFeature,
  type AiHelperRowDto,
  type AiModelRowDto,
  type AiOutletRowDto,
  type AiOverviewDto,
  type AiRequestEntryDto,
  type AiRequestPageDto,
  type AiSettingsDto,
  type AiSource,
  type AiStatus,
  type AiUsageQuery,
  type AiWarningDto,
  type LocalizedText,
  type Role,
  can,
} from '@eccs/shared';
import { csvCell } from '../activity-log/activity-log-reader.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { indiaDate } from '../checklists/checklists.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiSettingsService } from './ai-settings.service.js';
import { AiService } from './ai.service.js';

// The AI usage page (Stage F, 19 Oct 2026): what the AI helpers cost, read from the request
// log (AiRequest) the server writes for each AI call. Everything is summed in the database
// (Prisma's groupBy, and SQL where a day, an hour or a middle value is needed), never by
// loading every row. Every figure follows the page's filters, except the key's credit (one
// key for everything) and the warnings (the state of the whole platform). Days and hours
// are India time. Money goes out in US dollars, with the rupee rate set in the settings.
//
// PATTERN FOLLOWED: Anthropic Console's cost and usage reports (by model, by day, drill down);
// Langfuse and Helicone (cost per generation by token type, per user and feature, filters by
// user, model and time); Metabase's guide to LLM cost dashboards (cost by model, cost per
// request, the most expensive features).

type Where = Prisma.AiRequestWhereInput;

const micro = (value: number | bigint | null | undefined) => Number(value ?? 0);
const toUsd = (microUsd: number | bigint | null | undefined) => Math.round(micro(microUsd)) / 1_000_000;
const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
/** India day of a moment, as SQL. The column holds UTC without a zone. */
const INDIA_DAY = Prisma.sql`to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')`;
const INDIA_HOUR = Prisma.sql`EXTRACT(HOUR FROM ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::int`;
const EVERYONE_LIMITS = ['DAILY_LIMIT', 'MONTH_LIMIT'];
/** Answered, failed or thrown away: the request reached the model. */
const TRIED: AiStatus[] = ['OK', 'ERROR', 'INVALID'];
const FAILED: AiStatus[] = ['ERROR', 'INVALID'];
const CYCLE_MONTHS: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12 };

/** Which filters to leave out of a query: the period (a query with its own dates), the result (the limits' own counts). */
interface Leave {
  period?: boolean;
  result?: boolean;
}

@Injectable()
export class AiUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly config: AiSettingsService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  // ───────────────────────── Filters ─────────────────────────

  /** The filters as a Prisma condition, between two India dates (both counted). */
  private where(query: AiUsageQuery, from: string, to: string, leave: Leave = {}): Where {
    return {
      ...(!leave.period && { createdAt: { gte: indiaMidnightOf(from), lt: indiaMidnightOf(addDays(to, 1)) } }),
      ...(query.org.length > 0 && { organizationId: { in: query.org } }),
      ...(query.outlet.length > 0 && { outletId: { in: query.outlet } }),
      ...(query.feature.length > 0 && { feature: { in: query.feature } }),
      ...(query.model.length > 0 && { model: { in: query.model } }),
      ...(query.source.length > 0 && { source: { in: query.source } }),
      ...(!leave.result && query.result.length > 0 && { status: { in: statusesOf(query.result) } }),
    };
  }

  /** The same filters as SQL, for the queries Prisma's groupBy cannot do (by day, by hour, the middle time). */
  private sql(query: AiUsageQuery, from: string, to: string, leave: Leave = {}): Prisma.Sql {
    const parts: Prisma.Sql[] = [];
    if (!leave.period) parts.push(Prisma.sql`"createdAt" >= ${indiaMidnightOf(from)} AND "createdAt" < ${indiaMidnightOf(addDays(to, 1))}`);
    if (query.org.length > 0) parts.push(Prisma.sql`"organizationId" IN (${Prisma.join(query.org)})`);
    if (query.outlet.length > 0) parts.push(Prisma.sql`"outletId" IN (${Prisma.join(query.outlet)})`);
    if (query.feature.length > 0) parts.push(Prisma.sql`"feature" IN (${Prisma.join(query.feature)})`);
    if (query.model.length > 0) parts.push(Prisma.sql`"model" IN (${Prisma.join(query.model)})`);
    if (query.source.length > 0) parts.push(Prisma.sql`"source" IN (${Prisma.join(query.source)})`);
    if (!leave.result && query.result.length > 0) parts.push(Prisma.sql`"status" IN (${Prisma.join(statusesOf(query.result))})`);
    return parts.length > 0 ? Prisma.join(parts, ' AND ') : Prisma.sql`TRUE`;
  }

  // ───────────────────────── The overview ─────────────────────────

  async overview(query: AiUsageQuery): Promise<AiOverviewDto> {
    const settings = await this.config.fresh();
    const rate = settings.key.rupeeRate;
    const today = indiaDate();
    const range = aiUsageRange(query, today);
    const days = dayCount(range.from, range.to);
    const where = this.where(query, range.from, range.to);
    const limitsWhere = this.where(query, range.from, range.to, { result: true });
    const oneOutlet = query.outlet.length === 1 ? query.outlet[0]! : null;
    const limits = this.ai.limits();

    // The chart: at least two weeks, ending on the period's last day (at most about two months).
    const chartDays = Math.min(Math.max(days, AI_USAGE_RULES.chartDays), AI_USAGE_RULES.chartMaxDays);
    const chartFrom = addDays(range.to, -(chartDays - 1));
    const monthStart = `${today.slice(0, 7)}-01`;

    const [byFeatureStatus, byOutcome, medians, chart, hours, bySource, models, refusedCount, cappedOutlets, todayCost, monthCost, credit, lastWeek, facets] = await Promise.all([
      this.db.aiRequest.groupBy({ by: ['feature', 'status', 'errorCode'], where, _count: { _all: true }, _sum: { costMicroUsd: true } }),
      this.db.aiRequest.groupBy({ by: ['feature', 'outcome'], where: { AND: [where, { outcome: { not: null } }] }, _count: { _all: true } }),
      this.db.$queryRaw<{ feature: string; ms: number | null }[]>`
        SELECT "feature", percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationMs")::float AS ms
        FROM "AiRequest" WHERE ${this.sql(query, range.from, range.to)} AND "status" = 'OK' GROUP BY 1`,
      this.chart(query, chartFrom, range.to, oneOutlet),
      this.db.$queryRaw<{ hour: number; requests: bigint }[]>`
        SELECT ${INDIA_HOUR} AS hour, COUNT(*)::bigint AS requests
        FROM "AiRequest" WHERE ${this.sql(query, range.from, range.to)} GROUP BY 1 ORDER BY 2 DESC, 1 ASC LIMIT 1`,
      this.db.aiRequest.groupBy({ by: ['source'], where, _sum: { costMicroUsd: true } }),
      this.db.aiRequest.groupBy({
        by: ['model'],
        where,
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true, costMicroUsd: true },
      }),
      this.db.aiRequest.count({ where: { AND: [limitsWhere, { status: 'LIMIT' }] } }),
      this.db.aiRequest.groupBy({ by: ['outletId'], where: { AND: [limitsWhere, { status: 'LIMIT', errorCode: 'OUTLET_LIMIT', outletId: { not: null } }] } }),
      this.db.aiRequest.aggregate({ where: this.where(query, today, today), _sum: { costMicroUsd: true } }),
      this.db.aiRequest.aggregate({ where: this.where(query, monthStart, today), _sum: { costMicroUsd: true } }),
      // The key's credit and its pace: everything, whatever the filters.
      this.db.aiRequest.aggregate({ where: { createdAt: { gte: indiaMidnightOf(settings.key.loadedOn) } }, _sum: { costMicroUsd: true } }),
      this.db.aiRequest.aggregate({ where: { createdAt: { gte: indiaMidnightOf(addDays(today, -6)) } }, _sum: { costMicroUsd: true } }),
      this.facets(range.from, range.to),
    ]);

    // ── Helpers
    const helperRows = new Map<AiFeature, AiHelperRowDto>();
    const helperRow = (feature: AiFeature) => {
      let row = helperRows.get(feature);
      if (!row) {
        row = { feature, requests: 0, costUsd: 0, share: 0, tries: 0, failed: 0, refused: 0, medianMs: null, outcomes: { accepted: 0, edited: 0, discarded: 0, helpful: 0, notHelpful: 0 } };
        helperRows.set(feature, row);
      }
      return row;
    };
    let totalMicro = 0;
    let totalRequests = 0;
    for (const group of byFeatureStatus) {
      if (!(AI_FEATURES as readonly string[]).includes(group.feature)) continue;
      const row = helperRow(group.feature as AiFeature);
      const count = group._count._all;
      row.requests += count;
      row.costUsd += micro(group._sum.costMicroUsd);
      // A step stopped on purpose (Buddy's scope check refused the message) is neither a try nor a failure.
      const onPurpose = AI_STOPPED_ON_PURPOSE.includes(group.errorCode ?? '');
      if (TRIED.includes(group.status as AiStatus) && !onPurpose) row.tries += count;
      if (FAILED.includes(group.status as AiStatus) && !onPurpose) row.failed += count;
      if (group.status === 'LIMIT' || group.status === 'OFF') row.refused += count;
      totalMicro += micro(group._sum.costMicroUsd);
      totalRequests += count;
    }
    for (const group of byOutcome) {
      if (!(AI_FEATURES as readonly string[]).includes(group.feature)) continue;
      const outcomes = helperRow(group.feature as AiFeature).outcomes;
      const count = group._count._all;
      if (group.outcome === 'ACCEPTED') outcomes.accepted += count;
      if (group.outcome === 'EDITED') outcomes.edited += count;
      if (group.outcome === 'DISCARDED') outcomes.discarded += count;
      if (group.outcome === 'HELPFUL') outcomes.helpful += count;
      if (group.outcome === 'NOT_HELPFUL') outcomes.notHelpful += count;
    }
    for (const entry of medians) {
      if ((AI_FEATURES as readonly string[]).includes(entry.feature)) helperRow(entry.feature as AiFeature).medianMs = entry.ms === null ? null : Math.round(entry.ms);
    }
    // Every helper is listed (each has its switch), the costliest first, then the design's order.
    const helpers = AI_HELPER_ORDER.map((feature) => {
      const row = helperRow(feature);
      return { ...row, share: percent(row.costUsd, totalMicro), costUsd: toUsd(row.costUsd) };
    }).sort((a, b) => b.costUsd - a.costUsd || b.requests - a.requests || AI_HELPER_ORDER.indexOf(a.feature) - AI_HELPER_ORDER.indexOf(b.feature));

    // ── Outlets, and ECCS's own use
    const { outlets, eccsOwn, invoicedPaise } = await this.outlets(query, range.from, range.to, rate);

    // ── Cards
    const spentSince = toUsd(credit._sum.costMicroUsd);
    const left = creditLeft(settings.key.creditUsd, spentSince, toUsd(lastWeek._sum.costMicroUsd) / 7);
    const todayUsd = toUsd(todayCost._sum.costMicroUsd);
    const todayLimit = oneOutlet ? limits.outletDailyUsd : limits.dailyUsd;
    // Outlets removed since (tests) are no kitchen of anyone's.
    const perKitchen = await this.perKitchen(query, outlets.filter((row) => !row.removed), days, range.to);

    // ── Findings
    const forecast = monthForecast(toUsd(monthCost._sum.costMicroUsd), today);
    const busiest = hours[0] ? { hour: Number(hours[0].hour), requests: Number(hours[0].requests) } : null;
    const limitDays = chart.days.filter((day) => day.date >= range.from && day.everyoneLimit).map((day) => day.date);
    const nearCap = await this.nearCap(query, today, limits.outletDailyUsd);
    const findings = aiFindings({
      rate,
      helpers: helpers.map((row) => ({ feature: row.feature, costUsd: row.costUsd, share: row.share })),
      limitDays,
      // The busiest hour is said under the spend chart, as the design has it: not again here.
      busiestHour: null,
      nearCap,
      forecast: { forecastUsd: forecast.forecastUsd, monthlyLimitUsd: limits.monthlyUsd },
    });

    const chartRows: AiDayDto[] = chart.days.map(({ date, usd, requests, everyoneLimit, outletLimit }) => ({ date, usd, requests, limitHit: oneOutlet ? outletLimit : everyoneLimit }));
    return {
      today,
      range: { ...range, days },
      rate,
      cards: {
        spent: { usd: toUsd(totalMicro), requests: totalRequests },
        credit: { creditUsd: settings.key.creditUsd, loadedOn: settings.key.loadedOn, spentSinceUsd: spentSince, ...left },
        today: { usd: todayUsd, limitUsd: todayLimit, percent: percent(todayUsd, todayLimit), against: oneOutlet ? 'outlet' : 'everything' },
        perKitchen,
        refused: { requests: refusedCount, outletsCapped: cappedOutlets.length },
      },
      daily: {
        days: chartRows,
        limitUsd: todayLimit,
        against: oneOutlet ? 'outlet' : 'everything',
        busiestHour: busiest,
        // Quiet days are judged from the first day anything was spent, not the days before AI began.
        quiet: quietWeekday(chartRows.slice(Math.max(0, chartRows.findIndex((day) => day.usd > 0)))),
      },
      forecast: { monthUsd: toUsd(monthCost._sum.costMicroUsd), forecastUsd: forecast.forecastUsd, daysGone: forecast.daysGone, daysInMonth: forecast.daysInMonth, monthlyLimitUsd: limits.monthlyUsd },
      helpers,
      bySource: bySource.map((group) => ({ source: (group.source as AiSource | null) ?? null, usd: toUsd(group._sum.costMicroUsd) })).sort((a, b) => b.usd - a.usd),
      outlets,
      eccsOwn,
      invoicedPaise,
      models: models
        .map(
          (group): AiModelRowDto => ({
            model: group.model,
            requests: group._count._all,
            inputTokens: group._sum.inputTokens ?? 0,
            outputTokens: group._sum.outputTokens ?? 0,
            cacheReadTokens: group._sum.cacheReadTokens ?? 0,
            cacheWriteTokens: group._sum.cacheWriteTokens ?? 0,
            costUsd: toUsd(group._sum.costMicroUsd),
          }),
        )
        .sort((a, b) => b.costUsd - a.costUsd),
      findings,
      facets,
    };
  }

  /** Each day's spend and requests, and whether a limit refused requests that day (everyone's, or the outlet's own). */
  private async chart(query: AiUsageQuery, from: string, to: string, oneOutlet: string | null) {
    const results = query.result.length > 0 ? statusesOf(query.result) : null;
    // The result filter narrows the spend, never whether a limit was reached.
    const counted = results ? Prisma.sql`"status" IN (${Prisma.join(results)})` : Prisma.sql`TRUE`;
    const rows = await this.db.$queryRaw<{ day: string; cost: bigint | null; requests: bigint; everyone: boolean | null; outlet: boolean | null }[]>`
      SELECT ${INDIA_DAY} AS day,
             (SUM("costMicroUsd") FILTER (WHERE ${counted}))::bigint AS cost,
             COUNT(*) FILTER (WHERE ${counted})::bigint AS requests,
             bool_or("status" = 'LIMIT' AND "errorCode" IN (${Prisma.join(EVERYONE_LIMITS)})) AS everyone,
             bool_or("status" = 'LIMIT' AND "errorCode" = 'OUTLET_LIMIT') AS outlet
      FROM "AiRequest" WHERE ${this.sql(query, from, to, { result: true })}
      GROUP BY 1`;
    const byDay = new Map(rows.map((row) => [row.day, row]));
    const days: { date: string; usd: number; requests: number; everyoneLimit: boolean; outletLimit: boolean }[] = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const row = byDay.get(date);
      days.push({ date, usd: toUsd(row?.cost), requests: Number(row?.requests ?? 0), everyoneLimit: Boolean(row?.everyone), outletLimit: Boolean(row?.outlet) && Boolean(oneOutlet) });
    }
    return { days };
  }

  /**
   * "By restaurant": each outlet's use of the restaurant's helpers, with its plan, what it was
   * invoiced in the period (before GST) and the days its own cap refused requests. ECCS's own
   * work (the digest, the write-up, the shop board) and requests with no outlet are ECCS's own use.
   */
  private async outlets(query: AiUsageQuery, from: string, to: string, rate: number) {
    const where = this.where(query, from, to);
    const own = [...AI_ECCS_OWN_FEATURES];
    const [byOutletFeature, ownByFeature] = await Promise.all([
      this.db.aiRequest.groupBy({ by: ['outletId', 'feature'], where: { AND: [where, { outletId: { not: null } }, { feature: { notIn: own } }] }, _count: { _all: true }, _sum: { costMicroUsd: true } }),
      this.db.aiRequest.groupBy({ by: ['feature'], where: { AND: [where, { OR: [{ outletId: null }, { feature: { in: own } }] }] }, _count: { _all: true }, _sum: { costMicroUsd: true } }),
    ]);
    const perOutlet = new Map<string, { requests: number; micro: number; features: Map<string, { micro: number; requests: number }> }>();
    for (const group of byOutletFeature) {
      const entry = perOutlet.get(group.outletId!) ?? { requests: 0, micro: 0, features: new Map<string, { micro: number; requests: number }>() };
      entry.requests += group._count._all;
      entry.micro += micro(group._sum.costMicroUsd);
      entry.features.set(group.feature, { micro: micro(group._sum.costMicroUsd), requests: group._count._all });
      perOutlet.set(group.outletId!, entry);
    }
    const ids = [...perOutlet.keys()];
    const [places, subscriptions, invoices, capDays] = await Promise.all([
      this.db.outlet.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, organizationId: true, organization: { select: { name: true } } } }),
      this.db.subscription.findMany({
        where: { outletId: { in: ids }, status: 'ACTIVE' },
        select: { outletId: true, pricePaise: true, billingCycle: true, plan: { select: { name: true, pricePaise: true, billingCycle: true } } },
        orderBy: { startDate: 'desc' },
      }),
      this.db.invoice.groupBy({
        by: ['outletId'],
        where: { outletId: { in: ids }, status: { notIn: ['VOID', 'DRAFT'] }, issueDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
        _sum: { subtotalPaise: true },
      }),
      ids.length === 0
        ? Promise.resolve([] as { outletId: string; day: string }[])
        : this.db.$queryRaw<{ outletId: string; day: string }[]>`
            SELECT DISTINCT "outletId", ${INDIA_DAY} AS day FROM "AiRequest"
            WHERE ${this.sql(query, from, to, { result: true })} AND "status" = 'LIMIT' AND "errorCode" = 'OUTLET_LIMIT' AND "outletId" IN (${Prisma.join(ids)})
            ORDER BY 2`,
    ]);
    const place = new Map(places.map((entry) => [entry.id, entry]));
    const plan = new Map<string, AiOutletRowDto['plan']>();
    for (const subscription of subscriptions) {
      if (plan.has(subscription.outletId)) continue;
      plan.set(subscription.outletId, {
        name: localize(subscription.plan.name as LocalizedText, 'EN') || 'Plan',
        pricePaise: subscription.pricePaise ?? subscription.plan.pricePaise,
        cycle: subscription.billingCycle ?? subscription.plan.billingCycle,
      });
    }
    const invoiced = new Map(invoices.map((group) => [group.outletId!, group._sum.subtotalPaise ?? 0]));
    const capped = new Map<string, string[]>();
    for (const row of capDays) capped.set(row.outletId, [...(capped.get(row.outletId) ?? []), row.day]);

    const outlets: AiOutletRowDto[] = ids
      .map((outletId) => {
        const entry = perOutlet.get(outletId)!;
        const where = place.get(outletId);
        const costUsd = toUsd(entry.micro);
        const paid = invoiced.get(outletId) ?? 0;
        return {
          outletId,
          outletName: where?.name ?? 'A removed outlet',
          organizationId: where?.organizationId ?? null,
          organizationName: where?.organization.name ?? null,
          plan: plan.get(outletId) ?? null,
          requests: entry.requests,
          costUsd,
          invoicedPaise: paid,
          ofPayPercent: shareOfPay(costUsd, rate, paid),
          top: [...entry.features.entries()].sort((a, b) => b[1].micro - a[1].micro || b[1].requests - a[1].requests).slice(0, 2).map(([feature]) => feature as AiFeature),
          capDays: capped.get(outletId) ?? [],
        };
      })
      .sort((a, b) => b.costUsd - a.costUsd || b.requests - a.requests);

    // Outlets deleted since (test outlets of measuring runs) are gathered in one row: their spend was real.
    const gone = outlets.filter((row) => !place.has(row.outletId));
    const kept = outlets.filter((row) => place.has(row.outletId));
    if (gone.length > 0) {
      const features = new Map<AiFeature, number>();
      for (const row of gone) for (const feature of row.top) features.set(feature, (features.get(feature) ?? 0) + row.costUsd);
      const costUsd = Math.round(gone.reduce((sum, row) => sum + row.costUsd, 0) * 1_000_000) / 1_000_000;
      kept.push({
        outletId: 'removed',
        removed: gone.length,
        outletName: `${gone.length} outlet${gone.length === 1 ? '' : 's'} removed since`,
        organizationId: null,
        organizationName: null,
        plan: null,
        requests: gone.reduce((sum, row) => sum + row.requests, 0),
        costUsd,
        invoicedPaise: 0,
        ofPayPercent: null,
        top: [...features.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([feature]) => feature),
        capDays: [...new Set(gone.flatMap((row) => row.capDays))].sort(),
      });
      kept.sort((a, b) => b.costUsd - a.costUsd || b.requests - a.requests);
    }

    const ownRows = ownByFeature.filter((group) => (AI_FEATURES as readonly string[]).includes(group.feature));
    const eccsOwn = {
      requests: ownRows.reduce((sum, group) => sum + group._count._all, 0),
      costUsd: toUsd(ownRows.reduce((sum, group) => sum + micro(group._sum.costMicroUsd), 0)),
      top: [...ownRows].sort((a, b) => micro(b._sum.costMicroUsd) - micro(a._sum.costMicroUsd)).slice(0, 3).map((group) => group.feature as AiFeature),
    };
    return { outlets: kept, eccsOwn, invoicedPaise: kept.reduce((sum, row) => sum + row.invoicedPaise, 0) };
  }

  /**
   * "Per paying kitchen": the restaurants' AI cost in the period, at its daily pace over a
   * month, shared among the outlets with an active plan (under the restaurant and outlet
   * filters); and the cheapest plan's monthly price to set it against.
   */
  private async perKitchen(query: AiUsageQuery, outlets: AiOutletRowDto[], days: number, to: string): Promise<AiOverviewDto['cards']['perKitchen']> {
    const [paying, plans] = await Promise.all([
      this.db.subscription.findMany({
        where: {
          status: 'ACTIVE',
          ...(query.outlet.length > 0 && { outletId: { in: query.outlet } }),
          ...(query.org.length > 0 && { outlet: { organizationId: { in: query.org } } }),
        },
        select: { outletId: true },
        distinct: ['outletId'],
      }),
      this.db.plan.findMany({ where: { isActive: true }, select: { name: true, pricePaise: true, billingCycle: true } }),
    ]);
    const restaurantsUsd = outlets.reduce((sum, row) => sum + row.costUsd, 0);
    const cheapest = plans
      .map((entry) => ({ name: localize(entry.name as LocalizedText, 'EN') || 'Plan', monthlyPaise: Math.round(entry.pricePaise / (CYCLE_MONTHS[entry.billingCycle] ?? 1)) }))
      .sort((a, b) => a.monthlyPaise - b.monthlyPaise)[0];
    return {
      usdMonth: paying.length > 0 ? ((restaurantsUsd / Math.max(1, days)) * daysInMonth(to)) / paying.length : null,
      payingKitchens: paying.length,
      cheapestPlan: cheapest ?? null,
    };
  }

  /** Outlets that have used most of their own daily cap today (the restaurant's helpers only), under the filters. */
  private async nearCap(query: AiUsageQuery, today: string, outletDailyUsd: number): Promise<{ name: string; percent: number }[]> {
    if (outletDailyUsd <= 0) return [];
    const groups = await this.db.aiRequest.groupBy({
      by: ['outletId'],
      where: { AND: [this.where(query, today, today, { result: true }), { outletId: { not: null } }, { feature: { notIn: [...AI_ECCS_OWN_FEATURES] } }] },
      _sum: { costMicroUsd: true },
    });
    const near = groups
      .map((group) => ({ outletId: group.outletId!, percent: percent(toUsd(group._sum.costMicroUsd), outletDailyUsd) }))
      .filter((entry) => entry.percent >= AI_USAGE_RULES.nearCapPercent)
      .sort((a, b) => b.percent - a.percent);
    if (near.length === 0) return [];
    const names = await this.db.outlet.findMany({ where: { id: { in: near.map((entry) => entry.outletId) } }, select: { id: true, name: true, organization: { select: { name: true } } } });
    return near.map((entry) => {
      const outlet = names.find((row) => row.id === entry.outletId);
      return { name: outlet ? `${outlet.organization.name}, ${outlet.name}` : 'An outlet', percent: entry.percent };
    });
  }

  /** The choices of each filter menu in the period, with how many requests each has. */
  private async facets(from: string, to: string): Promise<AiOverviewDto['facets']> {
    const period: Where = { createdAt: { gte: indiaMidnightOf(from), lt: indiaMidnightOf(addDays(to, 1)) } };
    const count = <K extends 'organizationId' | 'outletId' | 'feature' | 'model' | 'source' | 'status'>(by: K) =>
      this.db.aiRequest.groupBy({ by: [by], where: period, _count: { _all: true } }) as unknown as Promise<({ _count: { _all: number } } & Record<K, string | null>)[]>;
    const [organizations, outlets, features, models, sources, statuses] = await Promise.all([
      count('organizationId'),
      count('outletId'),
      count('feature'),
      count('model'),
      count('source'),
      count('status'),
    ]);
    const outletIds = outlets.map((row) => row.outletId).filter((id): id is string => Boolean(id));
    const organizationIds = organizations.map((row) => row.organizationId).filter((id): id is string => Boolean(id));
    const [outletNames, organizationNames] = await Promise.all([
      this.db.outlet.findMany({ where: { id: { in: outletIds } }, select: { id: true, name: true, organization: { select: { name: true } } } }),
      this.db.organization.findMany({ where: { id: { in: organizationIds } }, select: { id: true, name: true } }),
    ]);
    const sorted = (options: AiFacetOptionDto[]) => options.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    const byResult = new Map<string, number>();
    for (const row of statuses) byResult.set(aiResultOf(row.status ?? ''), (byResult.get(aiResultOf(row.status ?? '')) ?? 0) + row._count._all);
    return {
      organizations: sorted(
        organizations.flatMap((row) => {
          const name = organizationNames.find((entry) => entry.id === row.organizationId)?.name;
          return row.organizationId && name ? [{ value: row.organizationId, label: name, count: row._count._all }] : [];
        }),
      ),
      outlets: sorted(
        outlets.flatMap((row) => {
          const outlet = outletNames.find((entry) => entry.id === row.outletId);
          return row.outletId && outlet ? [{ value: row.outletId, label: outlet.name, count: row._count._all, detail: outlet.organization.name }] : [];
        }),
      ),
      features: sorted(features.flatMap((row) => ((AI_FEATURES as readonly string[]).includes(row.feature ?? '') ? [{ value: row.feature!, label: AI_HELPERS[row.feature as AiFeature].name, count: row._count._all }] : []))),
      models: sorted(models.map((row) => ({ value: row.model ?? '', label: aiModelName(row.model ?? ''), count: row._count._all }))),
      sources: sorted(sources.flatMap((row) => ((AI_SOURCES as readonly string[]).includes(row.source ?? '') ? [{ value: row.source!, label: AI_SOURCE_LABELS[row.source as AiSource], count: row._count._all }] : []))),
      results: AI_RESULTS.filter((result) => byResult.has(result)).map((result) => ({ value: result, label: AI_RESULT_LABELS[result], count: byResult.get(result)! })),
    };
  }

  // ───────────────────────── The log ─────────────────────────

  /** The requests under the filters, newest first, a page at a time. */
  async requests(query: AiUsageQuery): Promise<AiRequestPageDto> {
    const range = aiUsageRange(query, indiaDate());
    const where = this.where(query, range.from, range.to);
    const take = query.limit ?? AI_USAGE_RULES.pageSize;
    const after = decodeCursor(query.cursor);
    const [rows, total] = await Promise.all([
      this.db.aiRequest.findMany({
        where: after ? { AND: [where, { OR: [{ createdAt: { lt: after.at } }, { createdAt: after.at, id: { lt: after.id } }] }] } : where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: take + 1,
      }),
      this.db.aiRequest.count({ where }),
    ]);
    const page = rows.slice(0, take);
    return { entries: await this.entries(page), nextCursor: rows.length > take ? encodeCursor(page[page.length - 1]!) : null, total };
  }

  /** Each row with its outlet's and restaurant's names and who asked (name and role). */
  private async entries(rows: Prisma.AiRequestGetPayload<object>[]): Promise<AiRequestEntryDto[]> {
    const userIds = [...new Set(rows.map((row) => row.userId).filter((id): id is string => Boolean(id)))];
    const outletIds = [...new Set(rows.map((row) => row.outletId).filter((id): id is string => Boolean(id)))];
    const organizationIds = [...new Set(rows.map((row) => row.organizationId).filter((id): id is string => Boolean(id)))];
    const [people, outlets, organizations] = await Promise.all([
      this.db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, memberships: { select: { role: true } } } }),
      this.db.outlet.findMany({ where: { id: { in: outletIds } }, select: { id: true, name: true } }),
      this.db.organization.findMany({ where: { id: { in: organizationIds } }, select: { id: true, name: true } }),
    ]);
    return rows.map((row) => {
      const person = people.find((entry) => entry.id === row.userId);
      const role = person ? mainRole(person.memberships.map((m) => m.role as Role)) : null;
      return {
        id: row.id,
        at: row.createdAt.toISOString(),
        feature: row.feature,
        model: row.model,
        source: (row.source as AiSource | null) ?? null,
        organizationId: row.organizationId,
        organizationName: organizations.find((entry) => entry.id === row.organizationId)?.name ?? null,
        outletId: row.outletId,
        outletName: outlets.find((entry) => entry.id === row.outletId)?.name ?? null,
        person: person ? { name: person.name, role: role ? ROLE_LABELS[role] : null } : row.userId ? { name: 'A removed login', role: null } : null,
        inputTokens: row.inputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheWriteTokens: row.cacheWriteTokens,
        outputTokens: row.outputTokens,
        costUsd: toUsd(row.costMicroUsd),
        durationMs: row.durationMs,
        status: row.status as AiStatus,
        errorCode: row.errorCode,
        outcome: row.outcome,
        resultCode: row.resultCode,
      };
    });
  }

  /**
   * The requests under the filters as a CSV file, newest first, at most 10,000. Only what the
   * log holds: no words of any prompt or answer (the log never has them).
   */
  async exportCsv(query: AiUsageQuery): Promise<{ csv: string; rows: number; truncated: boolean }> {
    const max = AI_USAGE_RULES.exportMax;
    const range = aiUsageRange(query, indiaDate());
    const rate = (await this.config.fresh()).key.rupeeRate;
    const rows = await this.db.aiRequest.findMany({ where: this.where(query, range.from, range.to), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: max + 1 });
    const entries = await this.entries(rows.slice(0, max));
    const header = [
      'Time (India)',
      'Time (UTC)',
      'Helper',
      'Model',
      'Where it runs',
      'Restaurant',
      'Outlet',
      'Person',
      'Role',
      'Input tokens',
      'Of which cache reads',
      'Of which cache writes',
      'Output tokens',
      'Cost (US$)',
      `Cost (₹ at ${rate})`,
      'Time taken (ms)',
      'Result',
      'Why (code)',
      'What the person did',
      'Kind of answer',
      'Request id',
    ];
    const lines = entries.map((entry) => [
      indiaTime(entry.at),
      entry.at,
      AI_HELPERS[entry.feature as AiFeature]?.name ?? entry.feature,
      aiModelName(entry.model),
      entry.source ? AI_SOURCE_LABELS[entry.source] : null,
      entry.organizationName,
      entry.outletName,
      entry.person?.name ?? null,
      entry.person?.role ?? null,
      entry.inputTokens,
      entry.cacheReadTokens,
      entry.cacheWriteTokens,
      entry.outputTokens,
      entry.costUsd.toFixed(6),
      (entry.costUsd * rate).toFixed(2),
      entry.durationMs,
      AI_RESULT_LABELS[aiResultOf(entry.status)],
      entry.errorCode ? (AI_LIMIT_LABELS[entry.errorCode] ?? entry.errorCode) : null,
      entry.outcome ? (AI_OUTCOME_LABELS[entry.outcome] ?? entry.outcome) : null,
      entry.resultCode,
      entry.id,
    ]);
    // The byte-order mark lets Excel read names written in Indian scripts correctly.
    const csv = `﻿${[header, ...lines].map((cells) => cells.map(csvCell).join(',')).join('\r\n')}\r\n`;
    return { csv, rows: entries.length, truncated: rows.length > max };
  }

  // ───────────────────────── Settings and warnings ─────────────────────────

  /** The Settings section: what is saved, what the server allows, who changed what. */
  async settings(user: AuthUser): Promise<AiSettingsDto> {
    const settings = await this.config.fresh();
    return {
      settings,
      canChange: can(user.memberships, 'aiUsage', 'update'),
      server: this.ai.serverFacts(),
      sections: this.config.sectionsChanged(),
      history: this.config.changes.slice(0, 10).map(({ at, by, role, changes }) => ({ at, by, role, changes })),
    };
  }

  /** The warnings true now, for the whole platform (the page's banner and the menu's count). */
  async alerts(): Promise<AiAlertsDto> {
    const settings = await this.config.fresh();
    const today = indiaDate();
    const limits = this.ai.limits();
    const server = this.ai.serverFacts();
    const [todayCost, monthCost, credit, tries] = await Promise.all([
      this.db.aiRequest.aggregate({ where: { createdAt: { gte: indiaMidnightOf(today) } }, _sum: { costMicroUsd: true } }),
      this.db.aiRequest.aggregate({ where: { createdAt: { gte: indiaMidnightOf(`${today.slice(0, 7)}-01`) } }, _sum: { costMicroUsd: true } }),
      this.db.aiRequest.aggregate({ where: { createdAt: { gte: indiaMidnightOf(settings.key.loadedOn) } }, _sum: { costMicroUsd: true } }),
      this.db.aiRequest.groupBy({ by: ['feature', 'status'], where: { createdAt: { gte: indiaMidnightOf(today) }, status: { in: TRIED }, OR: [{ errorCode: null }, { errorCode: { notIn: [...AI_STOPPED_ON_PURPOSE] } }] }, _count: { _all: true } }),
    ]);
    const perHelper = new Map<AiFeature, { feature: AiFeature; tries: number; failed: number }>();
    for (const group of tries) {
      if (!(AI_FEATURES as readonly string[]).includes(group.feature)) continue;
      const entry = perHelper.get(group.feature as AiFeature) ?? { feature: group.feature as AiFeature, tries: 0, failed: 0 };
      entry.tries += group._count._all;
      if (FAILED.includes(group.status as AiStatus)) entry.failed += group._count._all;
      perHelper.set(entry.feature, entry);
    }
    const warnings: AiWarningDto[] = aiWarnings({
      rate: settings.key.rupeeRate,
      serverOn: server.aiOn,
      keySet: server.keySet,
      consoleOn: settings.allOn,
      todayUsd: toUsd(todayCost._sum.costMicroUsd),
      dailyLimitUsd: limits.dailyUsd,
      dayPercent: settings.warnings.dayPercent,
      monthUsd: toUsd(monthCost._sum.costMicroUsd),
      monthlyLimitUsd: limits.monthlyUsd,
      monthPercent: settings.warnings.monthPercent,
      creditLeftUsd: Math.max(0, settings.key.creditUsd - toUsd(credit._sum.costMicroUsd)),
      creditUnderUsd: settings.warnings.creditUnderUsd,
      today: [...perHelper.values()],
    });
    return { warnings };
  }
}

const encodeCursor = (row: { createdAt: Date; id: string }) => Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');

function decodeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const time = at ? new Date(at) : null;
  return time && !Number.isNaN(time.getTime()) && id ? { at: time, id } : null;
}

/** India time for people reading the export, e.g. "19 Oct 2026, 14:42:07". */
const indiaTime = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(iso));
