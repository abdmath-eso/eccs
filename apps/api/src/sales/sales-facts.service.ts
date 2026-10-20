import { Injectable } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  type LeadFacts,
  type LeadStage,
  type LeadStatus,
  type LocalizedText,
  type QuoteLine,
  toQuoteOutcome,
} from '@eccs/shared';
import { PrismaService } from '../prisma/prisma.service.js';

// What the sales rules read about each lead (packages/shared/src/sales.ts, LeadFacts),
// gathered in one place for the Sales page, the Leads list, a lead's page, Do today and
// the nightly scoring, so every figure reads the same facts. Facts about the client a
// lead became (how many kitchens it pays for, whether its people use the app) come
// from the app's own records, never from the lead.
//
// Everything is read in full and worked out in memory: a sales team logs a few
// thousand leads a year. Move the sums into the database before that reaches tens of
// thousands.

export const leadInclude = {
  owner: { select: { id: true, name: true } },
  organization: { select: { id: true, name: true } },
  quotes: { orderBy: { createdAt: 'desc' } },
  // The steps the rules read: calls and visits (the day-10 call), what the owner asked,
  // free checks done (the weekly count) and wins (the weekly sales).
  activities: {
    where: { kind: { in: ['CALL', 'VISIT', 'ASKED', 'WON', 'CHECK_DONE'] } },
    select: { kind: true, at: true, signal: true, rating: true, sameDay: true, toStage: true, amountPaise: true },
  },
} as const satisfies Prisma.LeadInclude;
export type LeadRow = Prisma.LeadGetPayload<{ include: typeof leadInclude }>;
type QuoteRow = LeadRow['quotes'][number];

/** What is known about a client a lead was linked to. */
interface ClientFacts {
  /** Outlets that pay ECCS: on a plan now, or with an approved visit or a paid invoice. */
  payingOutlets: number;
  /** Outlets on a plan now, and the plan most of them are on. */
  onPlan: number;
  planName: string | null;
  /** Days of the last seven its people used the app (from the activity log). */
  activeDays: number;
}

export interface FactsContext {
  clients: Map<string, ClientFacts>;
  /** Where plan customers are: ON_PLAN leads' areas and plan outlets' addresses, lower case. */
  planPlaces: { text: string; organizationId: string | null; leadId: string | null }[];
  /** The plan to offer after a first job: the cheapest offered. */
  suggestedPlan: string | null;
}

const english = (text: unknown) => {
  const localized = (text ?? {}) as LocalizedText;
  return localized.en ?? Object.values(localized)[0] ?? '';
};

/** A quote's lines as kept, read back safely. */
export function quoteLines(stored: unknown): QuoteLine[] {
  return Array.isArray(stored) ? (stored as QuoteLine[]).filter((line) => line && typeof line === 'object' && typeof line.amountPaise === 'number') : [];
}

/** The latest quote sent, if any. */
export const latestSent = (quotes: readonly QuoteRow[]) =>
  quotes.filter((quote) => quote.status === 'SENT' && quote.sentAt).sort((a, b) => b.sentAt!.getTime() - a.sentAt!.getTime())[0] ?? null;

/** The latest quote sent with a plan on it, and that plan line. */
export function latestPlanQuote(quotes: readonly QuoteRow[]): { quote: QuoteRow; line: QuoteLine } | null {
  const sent = quotes.filter((quote) => quote.status === 'SENT' && quote.sentAt).sort((a, b) => b.sentAt!.getTime() - a.sentAt!.getTime());
  for (const quote of sent) {
    const line = quoteLines(quote.lines).find((entry) => entry.kind === 'PLAN');
    if (line) return { quote, line };
  }
  return null;
}

@Injectable()
export class SalesFactsService {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  async rows(where: Prisma.LeadWhereInput, options: { take?: number; orderBy?: Prisma.LeadOrderByWithRelationInput[] } = {}): Promise<LeadRow[]> {
    return this.db.lead.findMany({ where, include: leadInclude, orderBy: options.orderBy ?? [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }], ...(options.take && { take: options.take }) });
  }

  /** The facts about clients and plan customers the rules need for these leads. */
  async context(rows: readonly LeadRow[]): Promise<FactsContext> {
    const organizationIds = [...new Set(rows.map((row) => row.organizationId).filter((id): id is string => !!id))];
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const [subscriptions, onPlanLeads, cheapest, jobs, invoices, days] = await Promise.all([
      this.db.subscription.findMany({
        where: { status: 'ACTIVE', outlet: { organization: { isActive: true } } },
        select: { outletId: true, outlet: { select: { organizationId: true, address: true } }, plan: { select: { name: true } } },
      }),
      this.db.lead.findMany({ where: { stage: 'ON_PLAN', status: { not: 'LOST' }, area: { not: null } }, select: { id: true, area: true, organizationId: true } }),
      this.db.plan.findFirst({ where: { isActive: true }, orderBy: { pricePaise: 'asc' }, select: { name: true } }),
      organizationIds.length === 0
        ? Promise.resolve([])
        : this.db.job.findMany({ where: { status: 'APPROVED', outlet: { organizationId: { in: organizationIds } } }, select: { outletId: true, outlet: { select: { organizationId: true } } } }),
      organizationIds.length === 0
        ? Promise.resolve([])
        : this.db.invoice.findMany({ where: { organizationId: { in: organizationIds }, status: { in: ['PAID', 'PARTIALLY_PAID'] }, outletId: { not: null } }, select: { outletId: true, organizationId: true } }),
      organizationIds.length === 0
        ? Promise.resolve([] as { organizationId: string; days: bigint | number }[])
        : this.db.$queryRaw<{ organizationId: string; days: bigint | number }[]>`
            SELECT "organizationId", COUNT(DISTINCT to_char(("at" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')) AS days
            FROM "ActivityLog"
            WHERE "source" = 'RESTAURANT_APP' AND "at" >= ${weekAgo} AND "organizationId" = ANY(${organizationIds})
            GROUP BY 1`,
    ]);

    const clients = new Map<string, ClientFacts>();
    for (const id of organizationIds) {
      const plans = subscriptions.filter((entry) => entry.outlet.organizationId === id);
      const paying = new Set<string>([
        ...plans.map((entry) => entry.outletId),
        ...jobs.filter((job) => job.outlet.organizationId === id).map((job) => job.outletId),
        ...invoices.filter((invoice) => invoice.organizationId === id).map((invoice) => invoice.outletId!),
      ]);
      // The plan most of its outlets are on.
      const names = plans.map((entry) => english(entry.plan.name));
      const planName = names.sort((a, b) => names.filter((name) => name === b).length - names.filter((name) => name === a).length)[0] ?? null;
      const active = days.find((row) => row.organizationId === id);
      clients.set(id, { payingOutlets: paying.size, onPlan: new Set(plans.map((entry) => entry.outletId)).size, planName, activeDays: Number(active?.days ?? 0) });
    }

    return {
      clients,
      planPlaces: [
        ...onPlanLeads.map((lead) => ({ text: lead.area!.trim().toLowerCase(), organizationId: lead.organizationId, leadId: lead.id })),
        ...subscriptions.map((entry) => ({ text: entry.outlet.address.toLowerCase(), organizationId: entry.outlet.organizationId, leadId: null })),
      ],
      suggestedPlan: cheapest ? english(cheapest.name) : null,
    };
  }

  /** One lead's facts for the rules. */
  facts(row: LeadRow, context: FactsContext): LeadFacts {
    const sent = latestSent(row.quotes);
    const planQuote = latestPlanQuote(row.quotes);
    const contacts = row.activities.filter((entry) => entry.kind === 'CALL' || entry.kind === 'VISIT').map((entry) => entry.at.getTime());
    const firstJob = row.activities.find((entry) => entry.kind === 'WON' && entry.toStage === 'FIRST_JOB');
    const client = row.organizationId ? context.clients.get(row.organizationId) : undefined;

    // On a plan: the client's own plans when linked; otherwise what the plan quote said (sample history).
    let onPlan: LeadFacts['onPlan'] = null;
    if (row.stage === 'ON_PLAN') {
      onPlan = client && client.onPlan > 0 ? { kitchens: client.onPlan, planName: client.planName } : planQuote ? { kitchens: planQuote.line.quantity, planName: planQuote.line.name } : { kitchens: 1, planName: null };
    }

    const area = row.area?.trim().toLowerCase();
    const near =
      area && area.length >= 3
        ? context.planPlaces.find((place) => place.leadId !== row.id && (!row.organizationId || place.organizationId !== row.organizationId) && (place.text === area || place.text.includes(area)))
        : undefined;

    return {
      id: row.id,
      name: row.businessName,
      ownerId: row.ownerId,
      stage: row.stage as LeadStage,
      status: row.status as LeadStatus,
      kitchens: row.kitchens,
      area: row.area,
      hasPhone: Boolean(row.contactPhone),
      createdAt: row.createdAt.toISOString(),
      lastActivityAt: row.lastActivityAt.toISOString(),
      nextAction: row.nextAction,
      nextActionAt: row.nextActionAt?.toISOString() ?? null,
      parkedAt: row.parkedAt?.toISOString() ?? null,
      parkedUntil: row.parkedUntil ? row.parkedUntil.toISOString().slice(0, 10) : null,
      parkedReason: row.parkedReason,
      checkAt: row.checkAt?.toISOString() ?? null,
      checkWith: row.checkWith,
      checkDoneAt: row.checkDoneAt?.toISOString() ?? null,
      checkFindings: row.checkFindings,
      wonAt: row.wonAt?.toISOString() ?? null,
      planAt: row.planAt?.toISOString() ?? null,
      lastContactAt: contacts.length > 0 ? new Date(Math.max(...contacts)).toISOString() : null,
      quote: sent && {
        totalPaise: sent.totalPaise,
        sentAt: sent.sentAt!.toISOString(),
        openCount: sent.openCount,
        firstOpenedAt: sent.firstOpenedAt?.toISOString() ?? null,
        lastOpenedAt: sent.lastOpenedAt?.toISOString() ?? null,
        hasPlan: quoteLines(sent.lines).some((line) => line.kind === 'PLAN'),
        outcome: toQuoteOutcome(sent.outcome),
      },
      askedQuote: row.activities.some((entry) => entry.kind === 'ASKED' && entry.signal === 'QUOTE'),
      askedMonthlyPrice: row.activities.some((entry) => entry.kind === 'ASKED' && entry.signal === 'MONTHLY_PRICE'),
      // A first job counts as signed off when it came from an approved visit (the app sets "same day" then).
      firstJob: firstJob && firstJob.sameDay !== null ? { rating: firstJob.rating, sameDay: firstJob.sameDay } : null,
      onPlan,
      // A lead on a plan already pays for its kitchens on the plan, linked to a client or not.
      client:
        client || row.stage === 'ON_PLAN'
          ? { alreadyPaysKitchens: client ? client.payingOutlets : (onPlan?.kitchens ?? 0), ownerActiveDays: client?.activeDays ?? 0 }
          : null,
      nearPlanCustomer: near ? row.area : null,
      suggestedPlan: context.suggestedPlan,
    };
  }
}
