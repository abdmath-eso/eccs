"use client";

import {
  can,
  LEAD_SOURCE_COUNTED,
  LEAD_STAGE_LABELS,
  LEAD_STAGES,
  TARGET_FIGURES,
  TARGET_LABELS,
  type DoTodayItemDto,
  type SalesOverviewDto,
  type TargetFigures,
} from "@eccs/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { Button, HowItWorks, LoadError, Loading, NoAccess, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { describe } from "@/lib/format";
import { useNavCounts } from "@/lib/nav-counts";
import { useQuery } from "@/lib/query";
import { useSession } from "@/lib/session";

import { count, Legend, longWeekday, money, Panel, SampleBadge, Segmented } from "../finance/finance-parts";
import { GrowthLines, WonBars } from "./sales-charts";
import { DoTodayList, LeadSheet, LINE, ParkSheet, StageBar, StageTag, StatusDot, Sparkline } from "./sales-parts";
import { TargetsSheet } from "./targets-sheet";

// The Sales page (15 Oct 2026): leads, the day's to-dos and how sales are growing, for the
// founders, the Ops Manager and each BDE (who sees their own leads only).
//
// PATTERN FOLLOWED: the founder's own design (docs/design/2026-10-15 Sales dashboard),
// itself the shape of established CRM dashboards: Pipedrive's pipeline by stage with its
// value and "rotting" deals, a rep's prioritised list for the day (overdue first, as Odoo
// and Teamgate put it), HubSpot-style signals behind "likely to close", quota pacing by
// rep, and every figure next to its last four weeks. The main figures come first; the
// explanation is folded under "How this works".

export default function SalesScreen() {
  const { user } = useSession();
  const allowed = user ? can(user.memberships, "sales", "read") : false;
  if (!allowed) return <NoAccess title="Sales">The Sales page is for the founders, the Ops Manager and the BDEs.</NoAccess>;
  return <Sales />;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Sales() {
  const { user } = useSession();
  const query = useQuery();
  const router = useRouter();
  const { refresh: refreshCounts } = useNavCounts();
  const owner = query.get("owner") || null;
  const [loaded, setLoaded] = useState<{ key: string; data: SalesOverviewDto } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [adding, setAdding] = useState(false);
  const [targets, setTargets] = useState(false);
  const [parking, setParking] = useState<DoTodayItemDto | null>(null);
  const key = owner ?? "";

  useEffect(() => {
    let cancelled = false;
    api.sales
      .overview(key || null)
      .then((data) => {
        if (cancelled) return;
        setLoaded({ key, data });
        setError(null);
      })
      .catch((e) => !cancelled && setError({ key, message: describe(e) }));
    return () => {
      cancelled = true;
    };
  }, [key, attempt]);

  /** After anything changes: fetch the figures and the menu's number again. */
  const changed = () => {
    setAttempt((value) => value + 1);
    refreshCounts();
  };

  const data = loaded?.data ?? null;
  if (!data) {
    const failure = error && error.key === key ? error.message : null;
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Sales" description="Leads, today's to-dos and how sales are growing." />
        {failure ? <LoadError message={failure} onRetry={() => setAttempt((value) => value + 1)} /> : <Loading />}
      </div>
    );
  }

  const memberships = user?.memberships ?? [];
  const manages = can(memberships, "sales", "approve");
  // The founders and the Ops Manager see everyone's leads and can narrow the page to one person; a BDE sees their own.
  const sees = memberships.some((m) => m.role === "SUPER_ADMIN" || m.role === "OPS_MANAGER");
  const { cards, stages, growth } = data;
  const reloading = loaded?.key !== key;
  const headline = `${plural(data.headline.firstJobs, "first job")} and ${plural(data.headline.plans, "plan")} won this week. ${plural(data.headline.toDo, "thing")} to do today.`;

  return (
    <div className="flex flex-col gap-6">
      <div className="-mb-4 flex flex-wrap items-center gap-3 text-sm text-muted">
        <span>
          {longWeekday(data.today)} · week {data.weekNumber}
        </span>
        {data.sample && <SampleBadge />}
      </div>
      <PageHeader
        title={headline}
        secondary={
          <>
            <Link href="/sales/leads" className="rounded-lg border border-border-strong bg-surface px-4 py-2.5 font-semibold hover:bg-background">
              All leads
            </Link>
            {manages && (
              <Button variant="secondary" onClick={() => setTargets(true)}>
                Targets
              </Button>
            )}
          </>
        }
        action={<Button onClick={() => setAdding(true)}>Add lead</Button>}
      />

      {sees && (
        <Segmented
          label="Whose leads"
          showLabel={false}
          value={owner ?? ""}
          onChange={(value) => query.set({ owner: value || null }, "replace")}
          // A BDE by first name, as the design has it; anyone else by full name.
          options={[{ value: "", label: "Everyone" }, ...data.owners.map((person) => ({ value: person.id, label: person.isBde ? (person.name.split(/\s+/)[0] ?? person.name) : person.name }))]}
        />
      )}

      <div className={`flex flex-col gap-6 ${reloading ? "opacity-60" : ""}`} aria-busy={reloading}>
        {/* ── The four cards ── */}
        <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4">
          <Card label="Leads booked this week" value={String(cards.leads.week)} spark={cards.leads.spark}>
            {cards.leads.month} this month · {cards.leads.referrals} from referrals
          </Card>
          <Card label="Sales won this week" value={money(cards.won.weekPaise)} spark={cards.won.spark.map((paise) => paise / 100)}>
            {plural(cards.won.firstJobs, "first job")}, {plural(cards.won.plans, "plan")} · {money(cards.won.monthPaise)} this month
          </Card>
          <Card label="New customers this week" value={String(cards.customers.week)} spark={cards.customers.spark}>
            {plural(cards.customers.payingKitchens, "paying kitchen")} · {plural(cards.customers.people, "person", "people")} on the app
          </Card>
          <Card label="Free check to paid job" value={cards.conversion.checkToPaid === null ? "—" : `${cards.conversion.checkToPaid}%`} spark={cards.conversion.spark}>
            lead to customer {cards.conversion.leadToCustomer ?? "—"}% · quote to win {cards.conversion.quoteToWin ?? "—"}%
          </Card>
        </div>

        {/* ── Where the leads are ── */}
        <Panel
          title={`Where the ${stages.open} ${stages.open === 1 ? "lead is" : "leads are"} right now`}
          action={
            <span className="text-sm text-muted">
              plus{" "}
              <Link href="/sales/leads?state=parked" className="hover:underline">
                {stages.parked} parked until a date
              </Link>
              ,{" "}
              <Link href="/sales/leads?state=lost" className="hover:underline">
                {stages.lostThisMonth} lost this month
              </Link>
            </span>
          }
        >
          <StageBar counts={stages.counts} onPick={(stage) => router.push(`/sales/leads?state=open&stage=${stage}`)} />
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {LEAD_STAGES.map((stage) => (
              <li key={stage}>
                <Link href={`/sales/leads?state=open&stage=${stage}`} className="hover:underline">
                  <StageTag stage={stage}>
                    {LEAD_STAGE_LABELS[stage]}
                    {stage === "QUOTED" && stages.quotedPaise > 0 ? ` ${money(stages.quotedPaise)}` : ""}
                  </StageTag>
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">
            A lead moves right on its own when the step is logged.
            {cards.conversion.checkToPaid !== null && ` ${cards.conversion.checkToPaid}% of free checks turn into a paid job`}
            {cards.conversion.quoteToWin !== null && `; ${cards.conversion.quoteToWin}% of quotes are won`}
            {cards.conversion.checkToPaid !== null || cards.conversion.quoteToWin !== null ? "." : ""}
          </p>
        </Panel>

        {/* ── Do today, and beside it Likely to close and the week by BDE ── */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <Panel title="Do today" action={<span className="text-sm text-muted">set by the app from each lead&apos;s stage</span>}>
            <DoTodayList items={data.doToday} onChanged={changed} onPark={setParking} showOwner={sees} />
          </Panel>
          <div className="flex min-w-0 flex-col gap-6">
            <Panel title="Likely to close" action={<span className="text-sm text-muted">from signals, not opinions</span>}>
              {data.likely.length === 0 ? (
                <p className="text-sm text-muted">No lead shows a buying signal yet.</p>
              ) : (
                <ol className="flex flex-col divide-y divide-border">
                  {data.likely.map((entry, index) => (
                    <li key={entry.leadId} className="flex gap-3 py-3 first:pt-0">
                      <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                        {index + 1}
                      </span>
                      <span className="min-w-0">
                        <Link href={`/sales/leads/${entry.leadId}`} className="font-semibold hover:underline">
                          {entry.title}
                        </Link>
                        <span className="block text-sm text-muted">{entry.signals.join(" · ")}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              <p className="text-sm text-muted">Signals: the owner opened the quote, used the app, rated a job, asked about price, or runs more than one kitchen. Worked out again each night and whenever a lead changes.</p>
            </Panel>

            {data.byBde.length > 0 && (
              <Panel title="This week, by BDE" action={manages ? <Button variant="link" className="text-sm" onClick={() => setTargets(true)}>Targets</Button> : undefined}>
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {data.byBde.map((row) => (
                    <li key={row.userId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-2">
                      <span className="flex items-center gap-2 font-medium">
                        <StatusDot status={row.status} />
                        {row.name}
                      </span>
                      <span className="text-right tabular-nums">
                        {figures(row.actual)}
                        <span className="block text-xs text-muted">target {TARGET_FIGURES.map((figure) => row.targets[figure]).join(" · ")}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-muted">Green means every target is on pace for the week so far; amber, one behind; red, two or more. Targets reset every Monday from the last two weeks.</p>
              </Panel>
            )}
          </div>
        </div>

        {/* ── Growth ── */}
        <Panel title="Growth, week by week" description={`The dotted line is where the current pace lands by ${shortDay(growth.forecastDate)}.`}>
          <div className="grid gap-8 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-3">
              <h3 className="font-semibold">Customers and people on the app</h3>
              <Legend items={[{ label: "Paying kitchens", color: LINE.kitchens }, { label: "People using the app", color: LINE.people }]} />
              <GrowthLines weeks={growth.weeks} forecast={growth.forecast} forecastDate={growth.forecastDate} />
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold">Sales won each week, before GST</h3>
                <span className="text-sm text-muted">{money(growth.monthWonPaise)} this month</span>
              </div>
              <WonBars weeks={growth.weeks} nextWeekPaise={growth.nextWeekPaise} />
            </div>
          </div>
          <p className="text-sm text-muted">
            The forecast uses the last two weeks&apos; pace and today&apos;s pipeline ({plural(growth.pipeline.openQuotes, "quote")} open, {plural(growth.pipeline.checksDone, "check")} done).
            {growth.plans.prices.length > 0 && ` Plan customers add ${growth.plans.prices.map(money).join(" or ")} a month each;`} {plural(growth.plans.count, "plan")} today{" "}
            {growth.plans.count === 1 ? "is" : "are"} {money(growth.plans.monthlyPaise)} a month that repeats.
          </p>
        </Panel>

        {/* ── Where this month's first jobs came from ── */}
        <Sources data={data} />

        {can(memberships, "finance", "read") && (
          <Link href="/finance" className="self-end rounded-md px-1 font-semibold text-primary hover:underline">
            Accounts and margin →
          </Link>
        )}

        <HowItWorks>
          <p>A BDE logs a lead in a few seconds from the field; every follow-up date, the Do today list and the &quot;likely to close&quot; order come from the lead&apos;s stage and the owner&apos;s actions, not from anyone planning the day.</p>
          <p>Logging a call or a visit makes a lead Contacted; booking and doing the free check, and sending a quote, move it on. First job and On a plan come from the app itself once the lead is linked to the client it became (its approved visits, payments and plans). A lead never moves back by itself.</p>
          <p>A lead goes stale when nothing is logged for five days or its next step&apos;s date passes, and leaves the list when the next step is logged. Paying kitchens and people on the app are read from the app; a sample lead not linked to a client adds its own kitchens.</p>
        </HowItWorks>
      </div>

      <LeadSheet
        open={adding}
        lead={null}
        owners={sees ? data.owners : []}
        onClose={() => setAdding(false)}
        onSaved={(lead) => {
          changed();
          router.push(`/sales/leads/${lead.id}`);
        }}
      />
      <ParkSheet lead={parking && { id: parking.leadId, businessName: parking.businessName }} onClose={() => setParking(null)} onSaved={changed} />
      {manages && <TargetsSheet open={targets} onClose={() => setTargets(false)} overview={data} onSaved={changed} />}
    </div>
  );
}

const figures = (values: TargetFigures) => TARGET_FIGURES.map((figure) => plural(values[figure], TARGET_LABELS[figure][0], TARGET_LABELS[figure][1])).join(" · ");

const shortDay = (date: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "long" }).format(new Date(`${date}T00:00:00Z`));

/** One of the four cards: what it is, the figure, the figure in context, and the last four weeks. */
function Card({ label, value, spark, children }: { label: string; value: string; spark: readonly (number | null)[]; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface p-4">
      <span className="text-sm text-muted">{label}</span>
      <div className="flex items-end justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-2xl font-bold tracking-tight whitespace-nowrap tabular-nums">{value}</span>
          <span className="block text-xs text-muted">{children}</span>
        </span>
        <Sparkline values={spark} label={label} />
      </div>
    </div>
  );
}

/** "Where this month's 21 first jobs came from": the three biggest sources, the rest together. */
function Sources({ data }: { data: SalesOverviewDto }) {
  if (data.firstJobsThisMonth === 0) return null;
  // The three biggest by name; four or more of the rest share one figure, as in the design.
  const named = data.sources.length <= 4 ? data.sources : data.sources.slice(0, 3);
  const rest = data.sources.length <= 4 ? [] : data.sources.slice(3);
  const words = (source: (typeof data.sources)[number]["source"], n: number) => LEAD_SOURCE_COUNTED[source][n === 1 ? 0 : 1];
  return (
    <section aria-label="Where this month's first jobs came from" className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
      <span className="text-muted">Where this month&apos;s {count(data.firstJobsThisMonth, "first job")} came from</span>
      {named.map((entry) => (
        <span key={entry.source}>
          <strong className="text-lg tabular-nums">{entry.count}</strong> {words(entry.source, entry.count)}
        </span>
      ))}
      {rest.length > 0 && (
        <span>
          <strong className="text-lg tabular-nums">{rest.reduce((sum, entry) => sum + entry.count, 0)}</strong> {rest.map((entry) => LEAD_SOURCE_COUNTED[entry.source][1]).join(", ")}
        </span>
      )}
    </section>
  );
}
