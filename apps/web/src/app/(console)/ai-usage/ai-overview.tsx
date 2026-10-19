"use client";

import {
  AI_HELPERS,
  AI_MODEL_LABELS,
  AI_USAGE_RULES,
  aiModelName,
  hourRange,
  lastsWords,
  type AiFeature,
  type AiHelperRowDto,
  type AiModelKey,
  type AiOutletRowDto,
  type AiOverviewDto,
  type AiSettingsDto,
} from "@eccs/shared";
import { useState, type ReactNode } from "react";

import { Button, Switch } from "@/components/ui";

import { dayMonth, Legend, money, Panel } from "../finance/finance-parts";
import { inr, LIMIT_COLOR, Pill, plural, seconds, ShareBar, SpendChart, usd, whole, type Tone } from "./ai-usage-parts";

// The overview of the AI usage page, to the founder's design: five cards, the spend per day
// with the daily limit, the main switches and limits, by helper (with quality and speed
// folded under it), by restaurant, and by model. Every figure follows the filters.

export interface OverviewProps {
  data: AiOverviewDto;
  settings: AiSettingsDto | null;
  /** "this month", "last 7 days", "today", "in September", "1 to 18 Oct". */
  periodWords: string;
  /** True when a filter narrows the page (anything but the period). */
  narrowed: boolean;
  /** The helper or switch being saved, so its switch waits. */
  saving: string | null;
  onHelperSwitch: (feature: AiFeature, on: boolean) => void;
  onAllSwitch: (on: boolean) => void;
  onOutlet: (outlet: AiOutletRowDto) => void;
  onSettings: () => void;
}

export function Overview({ data, settings, periodWords, narrowed, saving, onHelperSwitch, onAllSwitch, onOutlet, onSettings }: OverviewProps) {
  const { cards, rate } = data;
  const rupees = (amount: number) => inr(amount, rate);
  const perRequest = cards.spent.requests > 0 ? cards.spent.usd / cards.spent.requests : 0;
  const todayTone: Tone = cards.today.percent >= 100 ? "bad" : cards.today.percent >= (settings?.settings.warnings.dayPercent ?? 80) ? "warn" : "good";
  const plan = cards.perKitchen.cheapestPlan;
  const perKitchenPercent = cards.perKitchen.usdMonth !== null && plan && plan.monthlyPaise > 0 ? Math.round((cards.perKitchen.usdMonth * rate * 100 * 1000) / plan.monthlyPaise) / 10 : null;

  return (
    <div className="flex flex-col gap-6">
      {/* ── The five cards ── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Card label={`Spent ${periodWords}`} value={rupees(cards.spent.usd)}>
          {usd(cards.spent.usd)} · {plural(cards.spent.requests, "request")}
          {cards.spent.requests > 0 && <> · {rupees(perRequest)} each</>}
        </Card>
        <Card label="Credit left on the key" value={usd(cards.credit.leftUsd)}>
          <ShareBar fraction={cards.credit.fraction} className="my-1" />
          of {usd(cards.credit.creditUsd)} loaded {dayMonth(cards.credit.loadedOn)} · {cards.credit.lastsDays === null ? "nothing spent this week" : `lasts ${lastsWords(cards.credit.lastsDays)} at this rate`}
        </Card>
        <Card label="Today" value={rupees(cards.today.usd)}>
          <Pill tone={todayTone} wrap>
            {cards.today.percent}% of the {rupees(cards.today.limitUsd)} {cards.today.against === "outlet" ? "cap" : "limit"}
          </Pill>
        </Card>
        <Card label="Per paying kitchen" value={cards.perKitchen.usdMonth === null ? "—" : rupees(cards.perKitchen.usdMonth)}>
          {cards.perKitchen.usdMonth === null
            ? "No outlet has an active plan yet"
            : `a month at this pace, average of ${plural(cards.perKitchen.payingKitchens, "kitchen")}${perKitchenPercent !== null && plan ? ` · ${perKitchenPercent}% of a ${money(plan.monthlyPaise)} plan` : ""}`}
        </Card>
        <Card label="Refused by limits" value={whole(cards.refused.requests)}>
          {cards.refused.requests === 1 ? "request" : "requests"} {periodWords} · {plural(cards.refused.outletsCapped, "outlet")} hit {cards.refused.outletsCapped === 1 ? "its" : "their"} daily cap
        </Card>
      </div>

      {/* ── Spend per day, and the switches and limits ── */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <SpendPanel data={data} narrowed={narrowed} />
        <SwitchesPanel data={data} settings={settings} saving={saving} onAllSwitch={onAllSwitch} onSettings={onSettings} />
      </div>

      <HelpersPanel data={data} settings={settings} periodWords={periodWords} narrowed={narrowed} saving={saving} onHelperSwitch={onHelperSwitch} />
      <OutletsPanel data={data} outletCapUsd={settings?.settings.limits.outletDailyUsd ?? null} periodWords={periodWords} onOutlet={onOutlet} />
      <ModelsPanel data={data} periodWords={periodWords} />

      <p className="text-sm text-muted">
        Every number here comes from the request log the server writes for each AI call: which helper, where it ran, which outlet, which person, tokens in and
        out, and what Anthropic charged. Nothing is typed in, and no words of any question or answer are kept.
      </p>
    </div>
  );
}

/** One of the five cards: what it is, the figure, and the figure in context underneath. */
function Card({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface p-3 sm:p-4">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-xl font-bold tracking-tight whitespace-nowrap tabular-nums sm:text-2xl xl:text-[1.375rem]">{value}</span>
      <span className="text-xs text-muted">{children}</span>
    </div>
  );
}

// ───────────────────────── Spend per day ─────────────────────────

function SpendPanel({ data, narrowed }: { data: AiOverviewDto; narrowed: boolean }) {
  const { daily, forecast, rate } = data;
  const rupees = (amount: number) => inr(amount, rate);
  // The limit is for everything (or one outlet's own cap): a line only where it applies to what is shown.
  const showLimit = daily.against === "outlet" || !narrowed;
  const limitDays = daily.days.filter((day) => day.limitHit);
  const first = daily.days[0]?.date ?? data.range.from;
  const title = daily.days.length === 14 && daily.days.at(-1)?.date === data.today ? "Spend per day, last 14 days" : `Spend per day, ${dayMonth(first)} to ${dayMonth(data.range.to)}`;
  const limitName = daily.against === "outlet" ? "the outlet's own daily cap" : "the daily limit";
  return (
    <Panel
      title={title}
      description={
        showLimit
          ? `The dashed line is ${limitName} (${usd(daily.limitUsd)} ≈ ${rupees(daily.limitUsd)}). A day that touches it refused some requests.`
          : "Narrowed by the filters, so the limit for everything is not drawn."
      }
    >
      <SpendChart days={daily.days} rate={rate} limitUsd={showLimit ? daily.limitUsd : null} caption={title} />
      <div className="flex flex-col gap-1.5 text-sm">
        {limitDays.length > 0 && (
          <Legend items={[{ label: `Hit ${limitName} (${limitDays.slice(0, 4).map((day) => dayMonth(day.date)).join(", ")}${limitDays.length > 4 ? "…" : ""})`, color: LIMIT_COLOR }]} />
        )}
        {daily.quiet && (
          <p className="text-muted">
            {daily.quiet.weekday}s are quiet: about {rupees(daily.quiet.usd)} a day.
          </p>
        )}
        {daily.busiestHour && <p className="text-muted">Busiest hour: {hourRange(daily.busiestHour.hour)}, {plural(daily.busiestHour.requests, "request")}.</p>}
        <p className="border-t border-border pt-2">
          This month at its pace: about <strong>{rupees(forecast.forecastUsd)}</strong> ({usd(forecast.forecastUsd)}) by the {forecast.daysInMonth}th
          {forecast.monthlyLimitUsd !== null && (
            <>
              ,{" "}
              {forecast.forecastUsd > forecast.monthlyLimitUsd ? (
                <strong className="text-danger">over the {usd(forecast.monthlyLimitUsd)} monthly limit</strong>
              ) : (
                <>under the {usd(forecast.monthlyLimitUsd)} monthly limit</>
              )}
            </>
          )}
          .
        </p>
      </div>
    </Panel>
  );
}

// ───────────────────────── Switches and limits ─────────────────────────

function SwitchesPanel({
  data,
  settings,
  saving,
  onAllSwitch,
  onSettings,
}: {
  data: AiOverviewDto;
  settings: AiSettingsDto | null;
  saving: string | null;
  onAllSwitch: (on: boolean) => void;
  onSettings: () => void;
}) {
  if (!settings) {
    return (
      <Panel title="Switches and limits">
        <p className="text-sm text-muted">Loading…</p>
      </Panel>
    );
  }
  const { settings: set, server, canChange } = settings;
  const rupees = (amount: number) => inr(amount, data.rate);
  // "Haiku 5.5 for 9 helpers, Sonnet 5.5 for 2".
  const byModel = new Map<AiModelKey, number>();
  for (const helper of Object.values(set.helpers)) byModel.set(helper.model, (byModel.get(helper.model) ?? 0) + 1);
  const models = [...byModel.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => `${AI_MODEL_LABELS[key]} for ${count}`);
  const row = (label: string, value: ReactNode) => (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2.5 last:border-0">
      <dt>{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </div>
  );
  return (
    <Panel
      title="Switches and limits"
      description="Changing one takes effect on the next request; nothing to reinstall."
      action={
        <Button variant="link" className="text-sm" onClick={onSettings}>
          {canChange ? "Change" : "See all"}
        </Button>
      }
    >
      <dl className="text-sm">
        <div className="flex items-center justify-between gap-4 border-b border-border pb-2">
          <dt>All AI helpers</dt>
          <dd>
            {canChange ? (
              <Switch label="All AI helpers" hideLabel checked={set.allOn} disabled={saving !== null} onChange={onAllSwitch} />
            ) : (
              <span className="font-semibold">{set.allOn ? "On" : "Off"}</span>
            )}
          </dd>
        </div>
        {!server.aiOn && <p className="py-2 font-semibold text-danger">Off on the server (AI_FEATURES=off): the console cannot switch AI on.</p>}
        {row("Daily limit, everything", `${usd(set.limits.dailyUsd)} · ${rupees(set.limits.dailyUsd)}`)}
        {row("Daily limit, per outlet", `${usd(set.limits.outletDailyUsd)} · ${rupees(set.limits.outletDailyUsd)}`)}
        {row("Monthly limit", set.limits.monthlyUsd === null ? <span className="text-muted">none</span> : `${usd(set.limits.monthlyUsd)} · ${rupees(set.limits.monthlyUsd)}`)}
        {row(
          "Monthly cap on the key",
          set.key.monthlyCapUsd === null ? <span className="text-muted">not entered</span> : <>{usd(set.key.monthlyCapUsd)} <span className="text-muted">in Anthropic&apos;s console</span></>,
        )}
        {row("Models in use", models.join(", "))}
        {row(
          "Warn when",
          <span className="block max-w-[16rem]">
            a day passes {set.warnings.dayPercent}% of the limit, or credit falls under {usd(set.warnings.creditUnderUsd)}
          </span>,
        )}
      </dl>
      <p className="text-xs text-muted">
        {server.engine === "fake" ? "This server uses the pretend AI of the tests: nothing here cost money." : "Tests use a pretend AI and cost nothing; real calls are only the ones in this log."}
      </p>
    </Panel>
  );
}

// ───────────────────────── By helper ─────────────────────────

/** The status pill of a helper: off, failing, most of the bill, unused, or fine. */
function helperStatus(row: AiHelperRowDto, settings: AiSettingsDto | null): { tone: Tone; words: string } {
  const set = settings?.settings;
  const offOnServer = settings ? !settings.server.aiOn || settings.server.disabled.includes(row.feature) : false;
  if (offOnServer) return { tone: "plain", words: "Off on the server" };
  if (set && (!set.allOn || !set.helpers[row.feature].on)) return { tone: "plain", words: "Off" };
  const failing = row.tries >= AI_USAGE_RULES.failingMinTries ? Math.round((row.failed / row.tries) * 100) : 0;
  if (failing > AI_USAGE_RULES.failingPercent) return { tone: "bad", words: `Failing ${failing}%` };
  if (row.share >= AI_USAGE_RULES.bigSharePercent) return { tone: "warn", words: `${row.share}% of spend · review` };
  if (row.requests === 0) return { tone: "plain", words: "Not used" };
  return { tone: "good", words: "Fine" };
}

function HelpersPanel({
  data,
  settings,
  periodWords,
  narrowed,
  saving,
  onHelperSwitch,
}: {
  data: AiOverviewDto;
  settings: AiSettingsDto | null;
  periodWords: string;
  narrowed: boolean;
  saving: string | null;
  onHelperSwitch: (feature: AiFeature, on: boolean) => void;
}) {
  const rupees = (amount: number) => inr(amount, data.rate);
  const total = data.cards.spent;
  const canChange = settings?.canChange ?? false;
  const by = (sources: string[]) => data.bySource.filter((entry) => entry.source && sources.includes(entry.source)).reduce((sum, entry) => sum + entry.usd, 0);
  const split = [
    { label: "App", usd: by(["RESTAURANT_APP", "SUPERVISOR_APP"]) },
    { label: "Console", usd: by(["CONSOLE"]) },
    { label: "Background", usd: by(["SYSTEM"]) },
  ].filter((part) => part.usd > 0);
  const share = (amount: number) => (total.usd > 0 ? Math.round((amount / total.usd) * 100) : 0);
  const switchFor = (row: AiHelperRowDto) => {
    const on = settings?.settings.helpers[row.feature].on ?? true;
    return canChange ? (
      <Switch label={AI_HELPERS[row.feature].name} hideLabel checked={on} disabled={saving !== null} onChange={(next) => onHelperSwitch(row.feature, next)} />
    ) : (
      <span className="text-muted">{on ? "On" : "Off"}</span>
    );
  };
  const perUse = (row: AiHelperRowDto) => (row.requests > 0 ? rupees(row.costUsd / row.requests) : "—");
  const anyUsed = data.helpers.some((row) => row.requests > 0);
  // Unfiltered, every helper is listed (each has its switch); narrowed, only those used.
  const rows = narrowed ? data.helpers.filter((row) => row.requests > 0) : data.helpers;
  const unused = data.helpers.length - rows.length;

  return (
    <Panel
      title={`By helper, ${periodWords}`}
      description={`Each helper has its own switch. Per use is what Anthropic charged, at ₹${data.rate} to the dollar; the bar is its part of the ${rupees(total.usd)}.`}
    >
      {/* A computer: the design's table. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[46rem] text-left text-sm">
          <thead className="text-muted">
            <tr className="border-b border-border">
              <th scope="col" className="py-2 pr-3 font-medium whitespace-nowrap">Helper</th>
              <th scope="col" className="py-2 pr-3 font-medium whitespace-nowrap">Where it runs</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium whitespace-nowrap">Requests</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium whitespace-nowrap">Per use</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium whitespace-nowrap">Cost</th>
              <th scope="col" className="w-28 py-2 pr-3 font-medium">Share</th>
              <th scope="col" className="py-2 pr-3 font-medium whitespace-nowrap">Status</th>
              <th scope="col" className="py-2 font-medium whitespace-nowrap">Switch</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const status = helperStatus(row, settings);
              const info = AI_HELPERS[row.feature];
              return (
                <tr key={row.feature} className="border-b border-border align-middle">
                  <td className="py-2 pr-3">
                    <span className="block font-semibold">{info.name}</span>
                    <span className="block text-xs text-muted">{info.about}</span>
                  </td>
                  <td className="py-2 pr-3 text-muted">{info.where}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{whole(row.requests)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{perUse(row)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{rupees(row.costUsd)}</td>
                  <td className="py-2 pr-3" title={`${row.share}% of the spend`}>
                    <ShareBar fraction={row.share / 100} />
                  </td>
                  <td className="py-2 pr-3">
                    <Pill tone={status.tone}>{status.words}</Pill>
                  </td>
                  <td className="py-1">{switchFor(row)}</td>
                </tr>
              );
            })}
            <tr className="font-bold">
              <td className="py-2.5 pr-3">Total</td>
              <td />
              <td className="py-2.5 pr-3 text-right tabular-nums">{whole(total.requests)}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{total.requests > 0 ? rupees(total.usd / total.requests) : "—"}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{rupees(total.usd)}</td>
              <td colSpan={3} className="py-2.5 text-xs font-normal text-muted">
                {split.map((part) => `${part.label} ${rupees(part.usd)} (${share(part.usd)}%)`).join(" · ")}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* A phone: one card per helper, the used ones first. */}
      <ul className="flex flex-col divide-y divide-border text-sm md:hidden">
        {rows.map((row) => {
          const status = helperStatus(row, settings);
          return (
            <li key={row.feature} className="flex flex-col gap-1.5 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block font-semibold">{AI_HELPERS[row.feature].name}</span>
                  <span className="block text-xs text-muted">{AI_HELPERS[row.feature].where}</span>
                </span>
                {switchFor(row)}
              </div>
              <ShareBar fraction={row.share / 100} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="tabular-nums">
                  <strong>{rupees(row.costUsd)}</strong> <span className="text-muted">· {plural(row.requests, "request")} · {perUse(row)} each</span>
                </span>
                <Pill tone={status.tone}>{status.words}</Pill>
              </div>
            </li>
          );
        })}
        <li className="pt-2.5 font-bold tabular-nums">
          Total {rupees(total.usd)} · {plural(total.requests, "request")}
          {split.length > 0 && <span className="block text-xs font-normal text-muted">{split.map((part) => `${part.label} ${rupees(part.usd)} (${share(part.usd)}%)`).join(" · ")}</span>}
        </li>
      </ul>

      {unused > 0 && <p className="text-sm text-muted">{plural(unused, "helper")} not used under these filters {unused === 1 ? "is" : "are"} left out.</p>}

      {data.findings.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-border pt-3 text-sm">
          {data.findings.map((finding) => (
            <li key={finding}>{finding}</li>
          ))}
        </ul>
      )}

      {anyUsed && <QualityTable data={data} />}
    </Panel>
  );
}

/** Quality and speed per helper, folded away: what people did with the answers, how often it failed, how long it took. */
function QualityTable({ data }: { data: AiOverviewDto }) {
  const used = data.helpers.filter((row) => row.requests > 0);
  const part = (count: number, of: number) => (of > 0 ? `${Math.round((count / of) * 100)}%` : "—");
  return (
    <details className="text-sm">
      <summary className="w-fit cursor-pointer rounded-md py-1 font-semibold text-primary">Quality and speed</summary>
      <p className="mt-1 text-muted">
        Where a helper records what people did with its answers, each as a share of the answers it recorded. Failed is of the tries that reached the model.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left">
          <thead className="text-muted">
            <tr className="border-b border-border">
              <th scope="col" className="py-2 pr-3 font-medium whitespace-nowrap">Helper</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium whitespace-nowrap">Kept</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium whitespace-nowrap">Edited</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium whitespace-nowrap">Thrown away</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium whitespace-nowrap">Helpful</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium whitespace-nowrap">Not helpful</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium whitespace-nowrap">Failed</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium whitespace-nowrap">Refused</th>
              <th scope="col" className="py-2 text-right font-medium whitespace-nowrap">Median time</th>
            </tr>
          </thead>
          <tbody>
            {used.map((row) => {
              const outcomes = row.outcomes;
              const recorded = outcomes.accepted + outcomes.edited + outcomes.discarded + outcomes.helpful + outcomes.notHelpful;
              const failing = row.tries > 0 && (row.failed / row.tries) * 100 > AI_USAGE_RULES.failingPercent;
              return (
                <tr key={row.feature} className="border-b border-border last:border-0">
                  <td className="py-2 pr-3">{AI_HELPERS[row.feature].name}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{part(outcomes.accepted, recorded)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{part(outcomes.edited, recorded)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{part(outcomes.discarded, recorded)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{part(outcomes.helpful, recorded)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{part(outcomes.notHelpful, recorded)}</td>
                  <td className={`py-2 pr-3 text-right tabular-nums ${failing ? "font-semibold text-danger" : ""}`}>
                    {row.tries > 0 ? `${part(row.failed, row.tries)} of ${whole(row.tries)}` : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.refused > 0 ? whole(row.refused) : "—"}</td>
                  <td className="py-2 text-right tabular-nums">{seconds(row.medianMs)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ───────────────────────── By restaurant ─────────────────────────

/** "Camera nudge" → "camera nudge" inside a sentence; a name that starts with capitals ("ECCS Buddy") stays as it is. */
const lowerFirst = (name: string) => (/^[A-Z][a-z]/.test(name) ? name[0]!.toLowerCase() + name.slice(1) : name);

/** "Against the daily cap": hit it, costs ECCS with nothing paid, or under. */
function capStatus(row: AiOutletRowDto): { tone: Tone; words: string } {
  if (row.removed) return { tone: "plain", words: "Removed" };
  if (row.capDays.length > 0) return { tone: "warn", words: `Hit the cap ${plural(row.capDays.length, "day")}` };
  if (!row.plan && row.invoicedPaise === 0) return { tone: "warn", words: "Costs ECCS, pays nothing yet" };
  return { tone: "good", words: "Under" };
}

function OutletsPanel({ data, outletCapUsd, periodWords, onOutlet }: { data: AiOverviewDto; outletCapUsd: number | null; periodWords: string; onOutlet: (outlet: AiOutletRowDto) => void }) {
  const [all, setAll] = useState(false);
  const rupees = (amount: number) => inr(amount, data.rate);
  const rows = all ? data.outlets : data.outlets.slice(0, AI_USAGE_RULES.outletsShown);
  const kept = data.outlets.filter((row) => !row.removed);
  // Of what the outlets pay: only outlets that still exist (removed test outlets paid nothing).
  const outletsUsd = kept.reduce((sum, row) => sum + row.costUsd, 0);
  const removed = data.outlets.find((row) => row.removed)?.removed ?? 0;
  const totalPercent = data.invoicedPaise > 0 ? Math.round(((outletsUsd * data.rate * 100) / data.invoicedPaise) * 1000) / 10 : null;
  const capRupees = outletCapUsd === null ? null : rupees(outletCapUsd);
  const plan = (row: AiOutletRowDto) => (row.plan ? `${row.plan.name} ${money(row.plan.pricePaise)}` : "No plan");
  const mostly = (row: AiOutletRowDto) => row.top.map((feature, index) => (index === 0 ? AI_HELPERS[feature].name : lowerFirst(AI_HELPERS[feature].name))).join(", ");
  // A share too small to show in tenths is still a share.
  const ofPay = (percent: number | null, costUsd: number) => (percent === null ? "—" : percent === 0 && costUsd > 0 ? "<0.1%" : `${percent}%`);
  const name = (row: AiOutletRowDto) =>
    row.removed ? (
      <span className="block">
        <span className="block font-medium">{row.outletName}</span>
        <span className="block text-xs text-muted">test outlets; what they spent was real</span>
      </span>
    ) : (
    <button type="button" onClick={() => onOutlet(row)} className="cursor-pointer text-left text-primary hover:underline">
      <span className="block font-medium">{row.organizationName ?? row.outletName}</span>
      <span className="block text-xs text-muted">{row.organizationName ? row.outletName : ""}</span>
    </button>
    );

  return (
    <Panel
      title={`By restaurant, ${periodWords}`}
      description="What each kitchen's use of the helpers costs ECCS, against what the kitchen pays. Choose an outlet to see its days."
      action={
        data.outlets.length > AI_USAGE_RULES.outletsShown ? (
          <Button variant="link" className="text-sm" onClick={() => setAll((open) => !open)}>
            {all ? "Fewer outlets" : `Show all ${data.outlets.length}`}
          </Button>
        ) : undefined
      }
    >
      {data.outlets.length === 0 ? (
        <p className="text-sm text-muted">No restaurant used the helpers {periodWords}.</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <thead className="text-muted">
                <tr className="border-b border-border">
                  <th scope="col" className="py-2 pr-3 font-medium whitespace-nowrap">Outlet</th>
                  <th scope="col" className="py-2 pr-3 font-medium whitespace-nowrap">Plan</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium whitespace-nowrap">Requests</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium whitespace-nowrap">AI cost</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium whitespace-nowrap">Of what they pay</th>
                  <th scope="col" className="py-2 pr-3 font-medium whitespace-nowrap">Mostly</th>
                  <th scope="col" className="py-2 font-medium whitespace-nowrap">Against the daily cap</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const status = capStatus(row);
                  return (
                    <tr key={row.outletId} className="border-b border-border align-top">
                      <td className="py-2 pr-3">{name(row)}</td>
                      <td className="py-2 pr-3">{plan(row)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{whole(row.requests)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{rupees(row.costUsd)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{ofPay(row.ofPayPercent, row.costUsd)}</td>
                      <td className="py-2 pr-3">{mostly(row)}</td>
                      <td className="py-2">
                        <Pill tone={status.tone}>{status.words}</Pill>
                      </td>
                    </tr>
                  );
                })}
                <tr className="font-bold">
                  <td colSpan={2} className="py-2.5 pr-3">
                    {kept.length === 1 ? "The outlet" : `All ${kept.length} outlets`}
                    {removed ? `, ${removed} removed,` : ""} and ECCS&apos;s own use
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{whole(data.cards.spent.requests)}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{rupees(data.cards.spent.usd)}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{totalPercent === null ? "—" : `${totalPercent}%`}</td>
                  <td colSpan={2} className="py-2.5 text-xs font-normal text-muted">
                    {data.eccsOwn.requests > 0 ? `ECCS's own: ${data.eccsOwn.top.map((feature) => lowerFirst(AI_HELPERS[feature].name)).join(", ")}, ${rupees(data.eccsOwn.costUsd)}` : "No use of ECCS's own"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col divide-y divide-border text-sm md:hidden">
            {rows.map((row) => {
              const status = capStatus(row);
              return (
                <li key={row.outletId} className="flex flex-col gap-1 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    {name(row)}
                    <span className="font-semibold whitespace-nowrap tabular-nums">{rupees(row.costUsd)}</span>
                  </div>
                  <p className="text-muted">
                    {plan(row)} · {plural(row.requests, "request")}
                    {row.ofPayPercent !== null && ` · ${ofPay(row.ofPayPercent, row.costUsd)} of what they pay`}
                  </p>
                  <p className="text-muted">Mostly {lowerFirst(mostly(row))}</p>
                  <span>
                    <Pill tone={status.tone}>{status.words}</Pill>
                  </span>
                </li>
              );
            })}
            <li className="pt-2.5 font-bold">
              All, and ECCS&apos;s own use: {rupees(data.cards.spent.usd)}
              {data.eccsOwn.requests > 0 && <span className="block text-xs font-normal text-muted">ECCS&apos;s own {rupees(data.eccsOwn.costUsd)}</span>}
            </li>
          </ul>
        </>
      )}
      <p className="text-xs text-muted">
        &quot;Of what they pay&quot; is the AI cost over the outlet&apos;s invoices {periodWords}, before GST. Each outlet&apos;s helpers stop for the day at its
        cap{capRupees ? ` (${capRupees})` : ""}; a trial outlet with no paid job is where that matters most.
      </p>
    </Panel>
  );
}

// ───────────────────────── By model ─────────────────────────

function ModelsPanel({ data, periodWords }: { data: AiOverviewDto; periodWords: string }) {
  const rupees = (amount: number) => inr(amount, data.rate);
  if (data.models.length === 0) return null;
  return (
    <Panel title={`By model, ${periodWords}`} description="Tokens are what each model read and wrote; cached tokens were read from (or written to) the prompt cache, at a tenth of the price or less.">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead className="text-muted">
            <tr className="border-b border-border">
              <th scope="col" className="py-2 pr-3 font-medium whitespace-nowrap">Model</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium whitespace-nowrap">Requests</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium whitespace-nowrap">Tokens in</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium whitespace-nowrap">Of which cached</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium whitespace-nowrap">Tokens out</th>
              <th scope="col" className="py-2 text-right font-medium whitespace-nowrap">Cost</th>
            </tr>
          </thead>
          <tbody>
            {data.models.map((row) => (
              <tr key={row.model} className="border-b border-border last:border-0">
                <td className="py-2 pr-3 font-medium whitespace-nowrap">{aiModelName(row.model)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{whole(row.requests)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{whole(row.inputTokens)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{row.cacheReadTokens + row.cacheWriteTokens > 0 ? whole(row.cacheReadTokens + row.cacheWriteTokens) : "—"}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{whole(row.outputTokens)}</td>
                <td className="py-2 text-right tabular-nums">
                  {rupees(row.costUsd)} <span className="text-muted">· {usd(row.costUsd)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

