"use client";

import {
  AI_HELPERS,
  AI_USAGE_PERIODS,
  aiUsageRange,
  can,
  monthLabel,
  monthName,
  type AiFeature,
  type AiOutletRowDto,
  type AiOverviewDto,
  type AiRequestEntryDto,
  type AiSettingsDto,
  type AiSettingsPatch,
  type AiUsagePeriod,
  type AiWarningDto,
} from "@eccs/shared";
import type { AiUsageFilters } from "@eccs/api-client";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useToast } from "@/components/toast";
import { Button, LoadError, Loading, NoAccess, PageHeader, ToggleGroup } from "@/components/ui";
import { api } from "@/lib/api";
import { describe, today } from "@/lib/format";
import { useNavCounts } from "@/lib/nav-counts";
import { useQuery } from "@/lib/query";
import { useSession } from "@/lib/session";

import { dayMonth, saveFile, Segmented, weekdayDay } from "../finance/finance-parts";
import { FilterMenu } from "../logs/filter-menu";
import { RequestLog } from "./ai-log";
import { OutletPanel } from "./ai-outlet-panel";
import { Overview } from "./ai-overview";
import { problemsOf, SettingsForm, type SaveChange } from "./ai-settings-form";
import { plural } from "./ai-usage-parts";

// The AI usage page (Stage F, 19 Oct 2026): Console > Business > AI usage. What the AI helpers
// cost, by helper, by screen and by restaurant, read from the server's request log; the log
// itself; and every AI setting (switches, models, limits, warnings, Buddy, the key's facts),
// which until now lived in the server's .env. The Super Admin and the Ops Manager see it;
// only the Super Admin changes the settings.
//
// PATTERN FOLLOWED: the founder's own design (docs/design/2026-10-19 AI usage dashboard),
// which wins where it is specific, and the common shape of AI cost dashboards:
// - Anthropic Console's cost and usage reports: breakdowns by model, by day and by key, and a
//   bar chart that drills down (support.anthropic.com/en/articles/9534590);
// - OpenAI's spend alerts that let requests continue, kept apart from hard spend limits that
//   refuse them (developers.openai.com/api/docs/guides/spend-limits);
// - gateway budgets (Portkey's budget limits and alerts, Respan, agentgateway): layered
//   budgets, a warning threshold apart from the block threshold;
// - Helicone's per-user cost views from request metadata, and Langfuse's cost per generation by
//   token type with dashboards filtered by user, model and time, and alerts on spend;
// - Metabase's Langfuse guide: cost by model, cost per request, the most expensive features.
// Filters live in the web address like the Logs page (a view can be bookmarked and shared, and
// comes back with Back); the main figures come first and the explanations are folded away.

const KEY = {
  tab: "tab",
  period: "period",
  from: "from",
  to: "to",
  org: "org",
  outlet: "outlet",
  feature: "feature",
  model: "model",
  source: "source",
  result: "result",
  /** The outlet whose own view is open in the side panel. */
  view: "view",
} as const;

type Tab = "overview" | "log" | "settings";
const LIST_KEYS = [KEY.org, KEY.outlet, KEY.feature, KEY.model, KEY.source, KEY.result] as const;
type ListKey = (typeof LIST_KEYS)[number];

const DIMENSION: Record<ListKey, string> = {
  org: "Restaurant",
  outlet: "Outlet",
  feature: "Helper",
  model: "Model",
  source: "Where it runs",
  result: "Result",
};

const list = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
const join = (values: string[]) => (values.length > 0 ? values.join(",") : null);

export default function AiUsageScreen() {
  const { user } = useSession();
  const allowed = user ? can(user.memberships, "aiUsage", "read") : false;
  if (!allowed) return <NoAccess title="AI usage">The AI usage page is for the Super Admin and the Operations Manager.</NoAccess>;
  return <AiUsage />;
}

/** The filters in the address, as the API takes them. */
function readFilters(params: URLSearchParams): AiUsageFilters & { period: AiUsagePeriod } {
  const period = (AI_USAGE_PERIODS as readonly string[]).includes(params.get(KEY.period) ?? "") ? (params.get(KEY.period) as AiUsagePeriod) : "month";
  return {
    period,
    ...(period === "custom" && params.get(KEY.from) && { from: params.get(KEY.from)! }),
    ...(period === "custom" && params.get(KEY.to) && { to: params.get(KEY.to)! }),
    org: list(params.get(KEY.org) ?? ""),
    outlet: list(params.get(KEY.outlet) ?? ""),
    feature: list(params.get(KEY.feature) ?? "") as AiFeature[],
    model: list(params.get(KEY.model) ?? ""),
    source: list(params.get(KEY.source) ?? "") as AiUsageFilters["source"],
    result: list(params.get(KEY.result) ?? "") as AiUsageFilters["result"],
  };
}

/** The address's filters only (not the tab or the open panel), so a change of either does not fetch again. */
function filterKey(params: URLSearchParams) {
  const kept = new URLSearchParams();
  for (const key of [KEY.period, KEY.from, KEY.to, ...LIST_KEYS]) {
    const value = params.get(key);
    if (value) kept.set(key, value);
  }
  return kept.toString();
}

function AiUsage() {
  const query = useQuery();
  const params = useSearchParams();
  const notify = useToast();
  const { refresh: refreshCounts } = useNavCounts();
  const now = today();

  const tab: Tab = params.get(KEY.tab) === "log" ? "log" : params.get(KEY.tab) === "settings" ? "settings" : "overview";
  const key = filterKey(params);
  const filters = readFilters(new URLSearchParams(key));
  const range = aiUsageRange({ period: filters.period, from: filters.from, to: filters.to }, now);
  const narrowed = LIST_KEYS.some((listKey) => list(params.get(listKey) ?? "").length > 0);
  const viewing = params.get(KEY.view) || null;

  const [overview, setOverview] = useState<{ key: string; data: AiOverviewDto } | null>(null);
  const [overviewError, setOverviewError] = useState<{ key: string; message: string } | null>(null);
  const [settings, setSettings] = useState<AiSettingsDto | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<AiWarningDto[]>([]);
  const [log, setLog] = useState<{ key: string; entries: AiRequestEntryDto[]; total: number; next: string | null } | null>(null);
  const [logError, setLogError] = useState<{ key: string; message: string } | null>(null);
  const [more, setMore] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  /** Names of chosen restaurants and outlets, kept for the chips while the menus load. */
  const [outletNames, setOutletNames] = useState<Record<string, string>>({});

  // The overview (its menus serve the log too), whenever a filter changes.
  useEffect(() => {
    if (tab === "settings") return;
    let cancelled = false;
    api.aiUsage
      .overview(readFilters(new URLSearchParams(key)))
      .then((data) => {
        if (cancelled) return;
        setOverview({ key, data });
        setOverviewError(null);
        setOutletNames((known) => ({
          ...known,
          ...Object.fromEntries([...data.facets.organizations, ...data.facets.outlets].map((option) => [option.value, option.label])),
          ...Object.fromEntries(data.outlets.map((row) => [row.outletId, row.outletName])),
        }));
      })
      .catch((error) => !cancelled && setOverviewError({ key, message: describe(error) }));
    return () => {
      cancelled = true;
    };
  }, [key, tab, attempt]);

  // The settings and the warnings: once, and again after a change.
  useEffect(() => {
    let cancelled = false;
    api.aiUsage
      .settings()
      .then((data) => {
        if (cancelled) return;
        setSettings(data);
        setSettingsError(null);
      })
      .catch((error) => !cancelled && setSettingsError(describe(error)));
    api.aiUsage
      .alerts()
      .then((data) => !cancelled && setWarnings(data.warnings))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // The log's first page, on the Log tab.
  useEffect(() => {
    if (tab !== "log") return;
    let cancelled = false;
    api.aiUsage
      .requests(readFilters(new URLSearchParams(key)))
      .then((page) => {
        if (cancelled) return;
        setLog({ key, entries: page.entries, total: page.total, next: page.nextCursor });
        setLogError(null);
        setMore({ busy: false, error: null });
      })
      .catch((error) => !cancelled && setLogError({ key, message: describe(error) }));
    return () => {
      cancelled = true;
    };
  }, [key, tab, attempt]);

  // ───────────────────────── Changing things ─────────────────────────

  const save: SaveChange = async (change: AiSettingsPatch, done: string) => {
    try {
      const saved = await api.aiUsage.saveSettings(change);
      setSettings(saved);
      notify(done);
      api.aiUsage
        .alerts()
        .then((data) => setWarnings(data.warnings))
        .catch(() => undefined);
      refreshCounts();
      return null;
    } catch (error) {
      return problemsOf(error);
    }
  };

  async function flip(what: string, change: AiSettingsPatch, done: string) {
    setSaving(what);
    const problems = await save(change, done);
    if (problems) notify(`Not saved: ${Object.values(problems)[0] ?? "something went wrong"}`);
    setSaving(null);
  }

  function choosePeriod(next: AiUsagePeriod) {
    if (next === "custom") query.set({ [KEY.period]: "custom", [KEY.from]: range.from, [KEY.to]: range.to }, "replace");
    else query.set({ [KEY.period]: next === "month" ? null : next, [KEY.from]: null, [KEY.to]: null }, "replace");
  }

  const clearFilters = () => query.set(Object.fromEntries(LIST_KEYS.map((listKey) => [listKey, null])));

  async function exportLog() {
    setExporting(true);
    try {
      const file = await api.aiUsage.exportCsv(filters);
      saveFile(file.blob, file.fileName);
      notify(file.truncated ? `Exported the newest ${plural(file.rows ?? 0, "request")}` : `Exported ${plural(file.rows ?? 0, "request")}`, {
        detail: file.truncated ? "That is the most one file holds. Narrow the period or the filters for the rest." : file.fileName,
      });
    } catch (error) {
      notify(`Could not export: ${describe(error)}`);
    } finally {
      setExporting(false);
    }
  }

  async function loadMore() {
    if (!log?.next) return;
    setMore({ busy: true, error: null });
    try {
      const page = await api.aiUsage.requests({ ...filters, cursor: log.next });
      setLog((now) => (now && now.key === log.key ? { ...now, entries: [...now.entries, ...page.entries.filter((entry) => !now.entries.some((e) => e.id === entry.id))], next: page.nextCursor } : now));
      setMore({ busy: false, error: null });
    } catch (error) {
      setMore({ busy: false, error: describe(error) });
    }
  }

  // ───────────────────────── Words ─────────────────────────

  const thisMonth = now.slice(0, 7);
  const lastMonth = `${new Date(Date.UTC(Number(now.slice(0, 4)), Number(now.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7)}`;
  const periodWords =
    filters.period === "month"
      ? "this month"
      : filters.period === "lastMonth"
        ? `in ${monthName(lastMonth)}`
        : filters.period === "7d"
          ? "in the last 7 days"
          : filters.period === "today"
            ? "today"
            : range.from === range.to
              ? `on ${dayMonth(range.from)}`
              : `from ${dayMonth(range.from)} to ${dayMonth(range.to)}`;
  const rangeLine =
    filters.period === "month"
      ? `${monthLabel(thisMonth)}, to ${weekdayDay(now)}`
      : filters.period === "today"
        ? `Today, ${weekdayDay(now)}`
        : filters.period === "lastMonth"
          ? monthLabel(lastMonth)
          : `${dayMonth(range.from)} to ${dayMonth(range.to)}`;
  const rate = overview?.data.rate ?? settings?.settings.key.rupeeRate ?? null;

  // ───────────────────────── Filter menus and chips ─────────────────────────

  const facets = overview?.data.facets ?? null;
  const optionsOf = (listKey: ListKey) => {
    if (!facets) return [];
    const from = { org: facets.organizations, outlet: facets.outlets, feature: facets.features, model: facets.models, source: facets.sources, result: facets.results }[listKey];
    return from.map((option) => ({ value: option.value, label: option.label, count: option.count, detail: option.detail ?? null }));
  };
  const nameOf = (listKey: ListKey, value: string) => optionsOf(listKey).find((option) => option.value === value)?.label ?? outletNames[value] ?? value;
  const chips = LIST_KEYS.flatMap((listKey) =>
    list(params.get(listKey) ?? "").map((value) => ({
      id: `${listKey}:${value}`,
      label: `${DIMENSION[listKey]}: ${nameOf(listKey, value)}`,
      remove: { [listKey]: join(list(params.get(listKey) ?? "").filter((item) => item !== value)) },
    })),
  );

  const openOutlet = (outlet: AiOutletRowDto) => {
    setOutletNames((known) => ({ ...known, [outlet.outletId]: outlet.organizationName ? `${outlet.organizationName}, ${outlet.outletName}` : outlet.outletName }));
    query.set({ [KEY.view]: outlet.outletId });
  };

  // ───────────────────────── The page ─────────────────────────

  const shown = overview && overview.key === key ? overview : null;
  const data = shown?.data ?? overview?.data ?? null;
  const failure = overviewError && overviewError.key === key ? overviewError.message : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="AI usage"
        description="What the AI helpers cost, by helper, by screen and by restaurant, and how they are set."
        secondary={
          tab !== "settings" ? (
            <Button variant="secondary" size="sm" onClick={() => void exportLog()} loading={exporting}>
              Export the log
            </Button>
          ) : undefined
        }
        how={
          <>
            <p>
              Every figure is read from the request log the server writes for each AI call, never typed in or sampled. Money is shown in rupees at the rate set
              under Settings, About the key; days and hours are India time.
            </p>
            <p>
              Limits refuse requests once reached, and the apps carry on without AI. Warnings only show at the top of this page. The server&apos;s own switch
              (AI_FEATURES in its .env) stays above everything here: when it is off, nothing here can switch AI on.
            </p>
          </>
        }
      />

      <p className="-mt-3 text-sm text-muted">
        {rangeLine} · India time{rate ? ` · 1 US$ = ₹${rate}` : ""}
      </p>

      {warnings.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Warnings">
          {warnings.map((warning) => (
            <li
              key={`${warning.kind}-${warning.text}`}
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${warning.level === "danger" ? "border-danger/40 bg-danger/5 text-danger" : "border-amber-300 bg-amber-50 text-amber-900"}`}
            >
              <span aria-hidden className="font-bold">
                !
              </span>
              <span>{warning.text}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="-mx-1 max-w-full overflow-x-auto px-1 py-0.5">
        <div className="w-max">
          <ToggleGroup
            label="Part of the page"
            value={tab}
            onChange={(next) => query.set({ [KEY.tab]: next === "overview" ? null : next, [KEY.view]: null })}
            options={[
              { value: "overview", label: "Overview" },
              { value: "log", label: "Log" },
              { value: "settings", label: "Settings" },
            ]}
          />
        </div>
      </div>

      {tab !== "settings" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            {/* On a phone the period chips scroll sideways rather than taking two lines. */}
            <div className="-mx-1 max-w-full overflow-x-auto px-1">
              <div className="w-max">
            <Segmented
              label="Period"
              showLabel={false}
              value={filters.period}
              onChange={choosePeriod}
              options={[
                { value: "month", label: monthName(thisMonth) },
                { value: "7d", label: "Last 7 days" },
                { value: "today", label: "Today" },
                { value: "lastMonth", label: monthName(lastMonth) },
                { value: "custom", label: "Dates" },
              ]}
            />
              </div>
            </div>
            {filters.period === "custom" && (
              <span className="flex items-center gap-1.5 text-sm">
                <label className="sr-only" htmlFor="ai-from">
                  From
                </label>
                <input
                  id="ai-from"
                  type="date"
                  value={range.from}
                  max={now}
                  onChange={(event) => event.target.value && query.set({ [KEY.from]: event.target.value }, "replace")}
                  className="rounded-lg border border-border-strong bg-surface px-2 py-1.5"
                />
                <span aria-hidden>to</span>
                <label className="sr-only" htmlFor="ai-to">
                  To
                </label>
                <input
                  id="ai-to"
                  type="date"
                  value={range.to}
                  max={now}
                  onChange={(event) => event.target.value && query.set({ [KEY.to]: event.target.value }, "replace")}
                  className="rounded-lg border border-border-strong bg-surface px-2 py-1.5"
                />
              </span>
            )}
            {/* A phone shows the filter menus only when asked, to keep the figures near the top. */}
            <Button variant="secondary" size="sm" className="sm:hidden" aria-expanded={showFilters} aria-controls="ai-filters" onClick={() => setShowFilters((open) => !open)}>
              {showFilters ? "Hide filters" : "Filters"}
              {chips.length > 0 && <span className="ml-1.5 font-normal">({chips.length})</span>}
            </Button>
          </div>

          <div className={showFilters ? "block" : "hidden sm:block"}>
            <div id="ai-filters" className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
              {LIST_KEYS.map((listKey) => (
                <FilterMenu
                  key={listKey}
                  label={DIMENSION[listKey]}
                  options={optionsOf(listKey)}
                  chosen={list(params.get(listKey) ?? "")}
                  names={(value) => nameOf(listKey, value)}
                  onChange={(values) => query.set({ [listKey]: join(values) })}
                  loading={!facets && !failure}
                  failed={Boolean(failure) && !facets}
                />
              ))}
            </div>
          </div>

          {chips.length > 0 && (
            <ul className="flex flex-wrap items-center gap-2" aria-label="Filters in use">
              {chips.map((chip) => (
                <li key={chip.id}>
                  <button
                    type="button"
                    onClick={() => query.set(chip.remove)}
                    aria-label={`Remove filter ${chip.label}`}
                    className="inline-flex max-w-xs cursor-pointer items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 py-1 pr-2 pl-3 text-sm hover:border-primary"
                  >
                    <span className="truncate">{chip.label}</span>
                    <span aria-hidden className="text-muted">
                      ✕
                    </span>
                  </button>
                </li>
              ))}
              <li>
                <button type="button" onClick={clearFilters} className="cursor-pointer rounded-md px-2 py-1 text-sm font-semibold text-primary hover:underline">
                  Clear all
                </button>
              </li>
            </ul>
          )}
        </div>
      )}

      {tab === "overview" &&
        (data ? (
          <div className={shown ? "" : "opacity-60"} aria-busy={!shown}>
            <Overview
              data={data}
              settings={settings}
              periodWords={periodWords}
              narrowed={narrowed}
              saving={saving}
              onHelperSwitch={(feature, on) => void flip(feature, { helpers: { [feature]: { on } } }, `${AI_HELPERS[feature].name} switched ${on ? "on" : "off"}. It applies from the next request.`)}
              onAllSwitch={(on) => void flip("all", { allOn: on }, on ? "All AI helpers switched on" : "All AI helpers switched off. The apps carry on without AI.")}
              onOutlet={openOutlet}
              onSettings={() => query.set({ [KEY.tab]: "settings" })}
            />
          </div>
        ) : failure ? (
          <LoadError message={failure} onRetry={() => setAttempt((n) => n + 1)} />
        ) : (
          <Loading />
        ))}

      {tab === "log" &&
        (log ? (
          <RequestLog
            entries={log.entries}
            total={log.total}
            rate={rate ?? 84}
            loading={log.key !== key}
            hasMore={Boolean(log.next) && log.key === key}
            moreBusy={more.busy}
            moreError={more.error}
            filtered={narrowed}
            onMore={() => void loadMore()}
            onClear={clearFilters}
          />
        ) : logError && logError.key === key ? (
          <LoadError message={logError.message} onRetry={() => setAttempt((n) => n + 1)} />
        ) : (
          <Loading />
        ))}

      {tab === "settings" &&
        (settings ? (
          <SettingsForm dto={settings} save={save} />
        ) : settingsError ? (
          <LoadError message={settingsError} onRetry={() => setAttempt((n) => n + 1)} />
        ) : (
          <Loading />
        ))}

      <OutletPanel
        outletId={viewing}
        name={viewing ? (outletNames[viewing] ?? "Outlet") : ""}
        period={{ period: filters.period, ...(filters.from && { from: filters.from }), ...(filters.to && { to: filters.to }) }}
        onClose={() => new URLSearchParams(window.location.search).get(KEY.view) && query.set({ [KEY.view]: null }, "replace")}
        onFilter={(outletId) => query.set({ [KEY.outlet]: outletId, [KEY.view]: null })}
      />
    </div>
  );
}
