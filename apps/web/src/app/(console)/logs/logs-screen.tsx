"use client";

import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_CATEGORY_KEYS,
  ACTIVITY_LOG_RULES,
  activityActionLabel,
  activityCategoryOf,
  can,
  ROLE_LABELS,
  type ActivityLogEntryDto,
  type ActivityLogFacetsDto,
  type ActivityLogSummaryDto,
  type Role,
} from "@eccs/shared";
import type { ActivityLogFilters } from "@eccs/api-client";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { useToast } from "@/components/toast";
import { Button, EmptyState, ErrorMessage, LoadError, Loading, NoAccess, PageHeader, Switch, ToggleGroup } from "@/components/ui";
import { api } from "@/lib/api";
import { describe, today } from "@/lib/format";
import { isPlainClick, useQuery } from "@/lib/query";
import { useSession } from "@/lib/session";

import { EventPanel, type PanelFilter } from "./event-panel";
import { FilterMenu, Popover, type MenuOption } from "./filter-menu";
import { AiMark, isFailure, ResultBadge, SourceBadge, Time } from "./log-parts";
import {
  AI_FEATURE_LABEL,
  AI_KEYS,
  AI_OUTCOME_LABEL,
  AI_STATUS_LABEL,
  aiModelLabel,
  apiFilters,
  clearedFilters,
  DEFAULT_PERIOD,
  entityLabel,
  filterKey,
  hasFilters,
  KEY,
  looksLikeIp,
  now,
  PERIODS,
  periodIsCurrent,
  readView,
  recordName,
  RESULT_LABEL,
  TABS,
  usd,
  type ListKey,
  type LogView,
  type Period,
  type Tab,
} from "./log-view";

// The Logs page (15 Oct 2026): everything that happens in the restaurant app, the
// Supervisor's app, the console, the AI and the server, for the Super Admin and the
// Ops Manager.
//
// PATTERN FOLLOWED: the audit and request logs of established products. GitHub's
// organisation audit log (filter by who, what action and where; actions grouped in
// categories), Stripe's Dashboard logs (quick filters for where a request came from
// and whether it succeeded; a row opens a side panel with every detail), WorkOS's
// audit log (by person, action and date, with CSV export), and the usual audit-log
// page: newest first, a period with presets, "failures only", filters shown as
// removable chips with "Clear all", a detail panel with copyable ids and links to the
// record. Every filter is in the web address (Baymard and the common filter-pattern
// guidance: a filtered view can be bookmarked, shared and comes back with Back).

const SOURCE_TAB: Record<string, Tab> = {
  RESTAURANT_APP: "restaurant",
  SUPERVISOR_APP: "supervisor",
  CONSOLE: "console",
  SYSTEM: "system",
  PUBLIC: "system",
};

/** The names of the list filters, for the chips. */
const DIMENSION: Record<ListKey, string> = {
  [KEY.organization]: "Restaurant",
  [KEY.outlet]: "Outlet",
  [KEY.person]: "Person",
  [KEY.role]: "Role",
  [KEY.area]: "Area",
  [KEY.action]: "Action",
  [KEY.result]: "Result",
  [KEY.aiFeature]: "AI feature",
  [KEY.aiModel]: "Model",
  [KEY.aiStatus]: "AI result",
  [KEY.aiOutcome]: "Outcome",
};

const LIVE_EVERY_MS = 10_000;

/** Where an area comes in the menus: the order of the list in packages/shared. */
const areaOrder = (category: string) => (ACTIVITY_CATEGORY_KEYS as readonly string[]).indexOf(category);

const join = (values: string[]) => (values.length > 0 ? values.join(",") : null);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

/** The rows' record line: its reference and name, e.g. "ECCS-0042 · Pest sighting". */
function recordLine(entry: ActivityLogEntryDto) {
  if (!entry.entityType) return "";
  const parts = [entry.reference, recordName(entry.entityType, entry.entityLabel)].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : entityLabel(entry.entityType);
}

/** Who, when nobody was logged in: the server's own work, a public page, or someone not logged in yet (a code asked for, a wrong PIN). */
const noPerson = (entry: ActivityLogEntryDto) => (entry.source === "SYSTEM" ? "System" : entry.source === "PUBLIC" ? "No login" : "Not logged in");

export default function LogsScreen() {
  const { user } = useSession();
  const allowed = user ? can(user.memberships, "auditLog", "read") : false;
  if (!allowed) {
    return <NoAccess title="Logs">The activity log is for the Super Admin and the Operations Manager.</NoAccess>;
  }
  return <Logs />;
}

interface Loaded {
  key: string;
  /** The filters these rows were fetched with, so "Load more" asks for the same rows. */
  filters: ActivityLogFilters;
  entries: ActivityLogEntryDto[];
  nextCursor: string | null;
  /** Rows brought in by Live, marked for a moment. */
  fresh: string[];
}

function Logs() {
  const query = useQuery();
  const params = useSearchParams();
  const notify = useToast();

  const key = filterKey(params);
  const view = readView(params);
  const eventId = params.get(KEY.event) || null;
  const ai = view.tab === "ai";
  const current = periodIsCurrent(view);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [summary, setSummary] = useState<{ key: string; data: ActivityLogSummaryDto } | null>(null);
  const [facets, setFacets] = useState<{ key: string; data: ActivityLogFacetsDto | null; failed: boolean } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [more, setMore] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  /** Names of the restaurants, outlets, people and records chosen, for the chips, as they were last seen. */
  const [names, setNames] = useState<Record<string, string>>({});
  const [live, setLive] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  /** True when this page opened the panel (a step was added to the history), so closing it can step back. */
  const openedHere = useRef(false);
  const loadedRef = useRef<Loaded | null>(null);
  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  function remember(pairs: [string, string | null | undefined][]) {
    setNames((known) => {
      let changed = false;
      const next = { ...known };
      for (const [name, value] of pairs) {
        if (value && next[name] !== value) {
          next[name] = value;
          changed = true;
        }
      }
      return changed ? next : known;
    });
  }

  const namesFromEntries = (entries: ActivityLogEntryDto[]): [string, string | null][] =>
    entries.flatMap((entry) => [
      [`${KEY.person}:${entry.actorUserId}`, entry.actorUserId ? entry.actorName : null],
      [`${KEY.organization}:${entry.organizationId}`, entry.organizationId ? entry.organizationName : null],
      [`${KEY.outlet}:${entry.outletId}`, entry.outletId ? entry.outletName : null],
    ]);

  // The list and the summary, whenever a filter changes.
  useEffect(() => {
    let cancelled = false;
    const filters = apiFilters(readView(new URLSearchParams(key)), now());
    Promise.all([api.activityLog.list(filters), api.activityLog.summary(filters)])
      .then(([page, totals]) => {
        if (cancelled) return;
        setLoaded({ key, filters, entries: page.entries, nextCursor: page.nextCursor, fresh: [] });
        setSummary({ key, data: totals });
        setError(null);
        setMore({ busy: false, error: null });
        remember(namesFromEntries(page.entries));
      })
      .catch((e) => !cancelled && setError({ key, message: describe(e) }));
    return () => {
      cancelled = true;
    };
  }, [key, attempt]);

  // The choices for the menus, with their counts, separately: the list does not wait for them.
  useEffect(() => {
    let cancelled = false;
    const filters = apiFilters(readView(new URLSearchParams(key)), now());
    api.activityLog
      .facets(filters)
      .then((data) => {
        if (cancelled) return;
        setFacets({ key, data, failed: false });
        remember([
          ...data.organizations.map((o): [string, string] => [`${KEY.organization}:${o.value}`, o.label]),
          ...data.outlets.map((o): [string, string] => [`${KEY.outlet}:${o.value}`, o.label]),
          ...data.people.map((p): [string, string] => [`${KEY.person}:${p.value}`, p.label]),
        ]);
      })
      .catch(() => !cancelled && setFacets((last) => ({ key, data: last?.data ?? null, failed: true })));
    return () => {
      cancelled = true;
    };
  }, [key, attempt]);

  // Live: every 10 seconds, new events go on top and the summary is brought up to date.
  useEffect(() => {
    if (!live || !current) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const shown = loadedRef.current;
      if (!shown || shown.key !== key) return;
      const filters = apiFilters(readView(new URLSearchParams(key)), now());
      Promise.all([api.activityLog.list(filters), api.activityLog.summary(filters)])
        .then(([page, totals]) => {
          const known = new Set(shown.entries.map((entry) => entry.id));
          const newest = shown.entries[0]?.at ?? "";
          const added = page.entries.filter((entry) => !known.has(entry.id) && entry.at >= newest);
          setCheckedAt(new Date().toISOString());
          setSummary({ key, data: totals });
          if (added.length === 0) return;
          setLoaded((now) =>
            now && now.key === key
              ? { ...now, entries: [...added.filter((entry) => !now.entries.some((e) => e.id === entry.id)), ...now.entries], fresh: added.map((e) => e.id) }
              : now,
          );
          remember(namesFromEntries(added));
        })
        .catch(() => undefined);
    }, LIVE_EVERY_MS);
    return () => clearInterval(timer);
  }, [live, current, key]);

  const shown = loaded && loaded.key === key ? loaded : null;
  // While new filters load, the last rows stay in view, dimmed, so the page does not jump.
  const rows = shown ?? loaded;
  const reloading = !shown && !!loaded;
  const failure = error && error.key === key ? error.message : null;
  const totals = summary && summary.key === key ? summary.data : null;
  const menu = facets?.data ?? null;
  const menuLoading = !facets || (facets.key !== key && !facets.failed);

  // ───────────────────────── Changing the view ─────────────────────────

  const setList = (listKey: ListKey, values: string[], extra: Record<string, string | null> = {}) =>
    query.set({ [listKey]: join(values), ...extra });

  /** The AI filters mean nothing outside the AI tab, and the area and action menus nothing inside it. */
  function tabChanges(next: Tab): Record<string, string | null> {
    const changes: Record<string, string | null> = { [KEY.tab]: next === "all" ? null : next };
    if (next === "ai") Object.assign(changes, { [KEY.area]: null, [KEY.action]: null });
    else for (const aiKey of AI_KEYS) changes[aiKey] = null;
    return changes;
  }

  function choosePeriod(next: Period) {
    if (next === "custom") {
      query.set({ [KEY.period]: "custom", [KEY.from]: view.from || today(), [KEY.to]: view.to || today() });
    } else {
      query.set({ [KEY.period]: next === DEFAULT_PERIOD ? null : next, [KEY.from]: null, [KEY.to]: null });
    }
  }

  function chooseRestaurants(next: string[]) {
    // An outlet of a restaurant no longer chosen is taken off too: the outlet menu follows the restaurant.
    const outletOwner = new Map((menu?.outlets ?? []).map((outlet) => [outlet.value, outlet.organizationId]));
    const outlets = next.length === 0 ? view.lists[KEY.outlet] : view.lists[KEY.outlet].filter((id) => !outletOwner.get(id) || next.includes(outletOwner.get(id)!));
    setList(KEY.organization, next, { [KEY.outlet]: join(outlets) });
  }

  function chooseAreas(next: string[]) {
    // Likewise an action outside the areas chosen: the action menu follows the area.
    const actions = next.length === 0 ? view.lists[KEY.action] : view.lists[KEY.action].filter((action) => next.includes(activityCategoryOf(action)));
    setList(KEY.area, next, { [KEY.action]: join(actions) });
  }

  /** What a link in the side panel changes in the address. */
  function panelChanges(filter: PanelFilter): Record<string, string | null> {
    const leaveAi = ai ? tabChanges("all") : {};
    switch (filter.kind) {
      case "source":
        return tabChanges(SOURCE_TAB[filter.value] ?? "all");
      case "person":
        remember([[`${KEY.person}:${filter.value}`, filter.name]]);
        return filter.alone ? { ...clearedFilters(), [KEY.person]: filter.value } : { [KEY.person]: filter.value };
      case "role":
        return { [KEY.role]: filter.value };
      case "restaurant":
        remember([[`${KEY.organization}:${filter.value}`, filter.name]]);
        return filter.alone ? { ...clearedFilters(), [KEY.organization]: filter.value } : { [KEY.organization]: filter.value, [KEY.outlet]: null };
      case "outlet":
        remember([[`${KEY.outlet}:${filter.value}`, filter.name]]);
        return { [KEY.outlet]: filter.value };
      case "area":
        return filter.value === "ai" ? tabChanges("ai") : { ...leaveAi, [KEY.area]: filter.value, [KEY.action]: null };
      case "action": {
        const areas = view.lists[KEY.area];
        const keepAreas = areas.includes(activityCategoryOf(filter.value)) ? join(areas) : null;
        return { ...leaveAi, [KEY.action]: filter.value, [KEY.area]: keepAreas };
      }
      case "record":
        remember([[`record:${filter.id}`, filter.name]]);
        return { ...clearedFilters(), [KEY.record]: filter.type, [KEY.recordId]: filter.id };
      case "ip":
        return { [KEY.ip]: filter.value, [KEY.device]: null };
      case "device":
        return { [KEY.device]: filter.value, [KEY.ip]: null };
      case "request":
        return { [KEY.request]: filter.value };
    }
  }

  // ───────────────────────── The side panel ─────────────────────────

  function openEvent(id: string) {
    if (id === eventId) return;
    openedHere.current = true;
    query.set({ [KEY.event]: id });
  }

  /** The panel closed (Escape, the ✕, a click beside it): the address follows. Back has already done so. */
  function panelClosed() {
    if (!new URLSearchParams(window.location.search).get(KEY.event)) return;
    if (openedHere.current) {
      openedHere.current = false;
      window.history.back();
    } else {
      query.set({ [KEY.event]: null }, "replace");
    }
  }

  function filterFromPanel(filter: PanelFilter) {
    const changes = { ...panelChanges(filter), [KEY.event]: null };
    // The panel's step in the history is replaced by the filtered list, so Back goes to the list as it was.
    if (openedHere.current) {
      openedHere.current = false;
      query.set(changes, "replace");
    } else {
      query.set(changes);
    }
  }

  const list = rows?.entries ?? [];
  const at = eventId ? list.findIndex((entry) => entry.id === eventId) : -1;

  // ───────────────────────── Export ─────────────────────────

  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      const file = await api.activityLog.exportCsv(apiFilters(view, now()));
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      // A browser on another address may not be allowed to read the server's own count; the summary's is close enough.
      const max = ACTIVITY_LOG_RULES.exportMax;
      const count = file.rows ?? Math.min(totals?.events ?? 0, max);
      const cut = file.truncated ?? (totals ? totals.events > max : false);
      notify(cut ? `Exported the newest ${plural(count, "event")}` : `Exported ${plural(count, "event")}`, {
        detail: cut ? "That is the most one file holds. Narrow the period or the filters for the rest." : file.fileName,
      });
    } catch (e) {
      setExportError(describe(e));
    } finally {
      setExporting(false);
    }
  }

  async function loadMore() {
    if (!shown?.nextCursor) return;
    setMore({ busy: true, error: null });
    try {
      const page = await api.activityLog.list({ ...shown.filters, cursor: shown.nextCursor });
      setLoaded((now) =>
        now && now.key === shown.key
          ? { ...now, entries: [...now.entries, ...page.entries.filter((entry) => !now.entries.some((e) => e.id === entry.id))], nextCursor: page.nextCursor }
          : now,
      );
      remember(namesFromEntries(page.entries));
      setMore({ busy: false, error: null });
    } catch (e) {
      setMore({ busy: false, error: describe(e) });
    }
  }

  // ───────────────────────── Menus and chips ─────────────────────────

  const nameOf = (listKey: ListKey, value: string): string => {
    switch (listKey) {
      case KEY.organization:
        return names[`${listKey}:${value}`] ?? "A restaurant";
      case KEY.outlet:
        return names[`${listKey}:${value}`] ?? "An outlet";
      case KEY.person:
        return names[`${listKey}:${value}`] ?? "A person";
      case KEY.role:
        return ROLE_LABELS[value as Role] ?? value;
      case KEY.area:
        return ACTIVITY_CATEGORIES[value as keyof typeof ACTIVITY_CATEGORIES] ?? value;
      case KEY.action:
        return activityActionLabel(value);
      case KEY.result:
        return RESULT_LABEL[value] ?? value;
      case KEY.aiFeature:
        return AI_FEATURE_LABEL[value] ?? value;
      case KEY.aiModel:
        return aiModelLabel(value);
      case KEY.aiStatus:
        return AI_STATUS_LABEL[value] ?? value;
      case KEY.aiOutcome:
        return AI_OUTCOME_LABEL[value] ?? value;
    }
  };

  const options = (listKey: ListKey, from: { value: string; label: string; count: number }[] | undefined, extra?: (value: string) => Partial<MenuOption>): MenuOption[] =>
    (from ?? []).map((option) => ({ value: option.value, label: nameOf(listKey, option.value) || option.label, count: option.count, ...extra?.(option.value) }));

  const outletOptions: MenuOption[] = (menu?.outlets ?? []).map((o) => ({ value: o.value, label: o.label, count: o.count, detail: o.organizationName }));
  const personOptions: MenuOption[] = (menu?.people ?? []).map((p) => ({ value: p.value, label: p.label, count: p.count, detail: p.role ? ROLE_LABELS[p.role] : null }));
  const organizationOptions: MenuOption[] = (menu?.organizations ?? []).map((o) => ({ value: o.value, label: o.label, count: o.count }));
  // Actions are listed under their area, in the menu's area order (GitHub's audit log groups its actions the same way).
  const actionOptions: MenuOption[] = [...(menu?.actions ?? [])]
    .sort((a, b) => areaOrder(a.category) - areaOrder(b.category) || b.count - a.count)
    .map((a) => ({ value: a.value, label: activityActionLabel(a.value), count: a.count, group: ACTIVITY_CATEGORIES[a.category as keyof typeof ACTIVITY_CATEGORIES] ?? a.category }));

  const menuProps = (listKey: ListKey, choices: MenuOption[], onChange?: (values: string[]) => void) => ({
    label: DIMENSION[listKey],
    options: choices,
    chosen: view.lists[listKey],
    names: (value: string) => nameOf(listKey, value),
    onChange: onChange ?? ((values: string[]) => setList(listKey, values)),
    loading: menuLoading,
    failed: facets?.failed,
  });

  const chips: { id: string; label: string; remove: Record<string, string | null> }[] = [];
  const chipKeys: ListKey[] = ai
    ? [KEY.organization, KEY.outlet, KEY.person, KEY.role, KEY.result, KEY.aiFeature, KEY.aiModel, KEY.aiStatus, KEY.aiOutcome]
    : [KEY.organization, KEY.outlet, KEY.person, KEY.role, KEY.area, KEY.action, KEY.result];
  for (const listKey of chipKeys) {
    for (const value of view.lists[listKey]) {
      chips.push({
        id: `${listKey}:${value}`,
        label: `${DIMENSION[listKey]}: ${nameOf(listKey, value)}`,
        remove: { [listKey]: join(view.lists[listKey].filter((item) => item !== value)) },
      });
    }
  }
  if (view.recordId) {
    const name = names[`record:${view.recordId}`] ?? [entityLabel(view.record), `${view.recordId.slice(0, 8)}…`].filter(Boolean).join(" · ");
    chips.push({ id: "record", label: `Record: ${name}`, remove: { [KEY.record]: null, [KEY.recordId]: null } });
  } else if (view.record) {
    chips.push({ id: "record", label: `Record type: ${entityLabel(view.record)}`, remove: { [KEY.record]: null } });
  }
  if (view.reference) chips.push({ id: "ref", label: `Reference: ${view.reference}`, remove: { [KEY.reference]: null } });
  if (view.ip) chips.push({ id: "ip", label: `IP: ${view.ip}`, remove: { [KEY.ip]: null } });
  if (view.device) chips.push({ id: "device", label: `Phone: ${view.device.slice(0, 10)}…`, remove: { [KEY.device]: null } });
  if (view.request) chips.push({ id: "request", label: `Same request: ${view.request.slice(0, 8)}…`, remove: { [KEY.request]: null } });
  if (view.offline) chips.push({ id: "offline", label: "Done offline", remove: { [KEY.offline]: null } });

  const moreCount =
    view.lists[KEY.role].length +
    (ai ? view.lists[KEY.result].length : 0) +
    (view.record ? 1 : 0) +
    (view.reference ? 1 : 0) +
    (view.ip || view.device ? 1 : 0) +
    (view.offline ? 1 : 0);
  const filterCount = chips.length;

  // ───────────────────────── Clicking a person or place in a row ─────────────────────────

  const filterTo = (listKey: ListKey, value: string, extra: Record<string, string | null> = {}) => query.set({ [listKey]: value, ...extra });

  // `fit` keeps a name on one line in the table, cut short with "…" (the side panel has it in full).
  const people = (entry: ActivityLogEntryDto, fit = "") =>
    entry.actorUserId ? (
      <FilterText className={fit} title={`Show only ${entry.actorName ?? "this person"}'s events`} onClick={() => filterTo(KEY.person, entry.actorUserId!)}>
        {entry.actorName ?? "Unknown person"}
      </FilterText>
    ) : (
      <span className={`text-muted ${fit}`}>{entry.actorName ?? noPerson(entry)}</span>
    );

  const restaurant = (entry: ActivityLogEntryDto, fit = "") =>
    entry.organizationId ? (
      <FilterText
        className={fit}
        title={`Show only ${entry.organizationName ?? "this restaurant"}'s events`}
        onClick={() => filterTo(KEY.organization, entry.organizationId!, { [KEY.outlet]: null })}
      >
        {entry.organizationName ?? "Unknown restaurant"}
      </FilterText>
    ) : null;

  const outlet = (entry: ActivityLogEntryDto, fit = "") =>
    entry.outletId ? (
      <FilterText className={fit} title={`Show only ${entry.outletName ?? "this outlet"}'s events`} onClick={() => filterTo(KEY.outlet, entry.outletId!)}>
        {entry.outletName ?? "Unknown outlet"}
      </FilterText>
    ) : null;

  const eventLink = (entry: ActivityLogEntryDto) => ({
    href: query.hrefWith({ [KEY.event]: entry.id }),
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (!isPlainClick(event)) return;
      event.preventDefault();
      openEvent(entry.id);
    },
  });

  /** A click anywhere on a row opens it, unless it was on a person, a place or the link itself. */
  const rowClick = (entry: ActivityLogEntryDto) => (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("a,button")) return;
    openEvent(entry.id);
  };

  const what = (entry: ActivityLogEntryDto) => {
    // An AI row says which model, what it cost, and how it ended when that was not a plain answer.
    const second = entry.ai
      ? [
          aiModelLabel(entry.ai.model),
          usd(entry.ai.costUsd),
          entry.ai.status && entry.ai.status !== "OK" ? AI_STATUS_LABEL[entry.ai.status] : "",
          entry.ai.outcome ? AI_OUTCOME_LABEL[entry.ai.outcome] : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : // A refused or failed page has no record; the page's address says which it was.
        recordLine(entry) || (entry.route && (entry.action === "auth.access.refused" || entry.action === "system.request.failed") ? entry.route : "");
    return (
      <>
        <a {...eventLink(entry)} className="font-semibold hover:underline">
          {entry.actionLabel}
        </a>
        {entry.category === "ai" && !ai && <AiMark />}
        {entry.offline && <span className="ml-1.5 rounded border border-border-strong px-1 text-[0.65rem] leading-4 font-semibold text-muted">Offline</span>}
        {second && <span className="block text-xs text-muted">{second}</span>}
      </>
    );
  };

  // ───────────────────────── The page ─────────────────────────

  const filtered = hasFilters(view) || view.tab !== "all";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Logs"
        secondary={
          <>
            <label className="sr-only" htmlFor="logs-period">
              Period
            </label>
            <select
              id="logs-period"
              value={view.period}
              onChange={(event) => choosePeriod(event.target.value as Period)}
              className="rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm font-semibold"
            >
              {PERIODS.map((period) => (
                <option key={period.value} value={period.value}>
                  {period.label}
                </option>
              ))}
            </select>
            {view.period === "custom" && (
              <span className="flex items-center gap-1.5 text-sm">
                <label className="sr-only" htmlFor="logs-from">
                  From
                </label>
                <input
                  id="logs-from"
                  type="date"
                  value={view.from}
                  max={today()}
                  onChange={(event) => query.set({ [KEY.from]: event.target.value || null }, "replace")}
                  className="rounded-lg border border-border-strong bg-surface px-2 py-1.5"
                />
                <span aria-hidden>to</span>
                <label className="sr-only" htmlFor="logs-to">
                  To
                </label>
                <input
                  id="logs-to"
                  type="date"
                  value={view.to}
                  max={today()}
                  onChange={(event) => query.set({ [KEY.to]: event.target.value || null }, "replace")}
                  className="rounded-lg border border-border-strong bg-surface px-2 py-1.5"
                />
              </span>
            )}
            <SearchBox value={view.q} onSearch={(text) => query.set({ [KEY.q]: text || null }, "replace")} />
            {/* A phone shows the filter menus only when asked, to keep the events near the top. */}
            <Button variant="secondary" size="sm" className="sm:hidden" aria-expanded={showFilters} aria-controls="logs-filters" onClick={() => setShowFilters((open) => !open)}>
              {showFilters ? "Hide filters" : "Filters"}
              {filterCount > 0 && <span className="ml-1.5 font-normal">({filterCount})</span>}
            </Button>
          </>
        }
        action={
          <Button variant="secondary" size="sm" onClick={() => void exportCsv()} loading={exporting}>
            Export CSV
          </Button>
        }
        how={
          <>
            <p>
              Every change made in the restaurant app, the Supervisor&apos;s app and the console is here, whether it worked or not, with logins, files
              opened, every AI request and the server&apos;s own timed work. Ordinary page views are not recorded; refusals and errors are.
            </p>
            <p>
              Kept for a year. Never recorded: PINs, one-time codes, passwords, messages or notes people typed, what was wrong on a checklist, or
              anything about a restaurant&apos;s staff beyond who changed a staff record and where. Times are India time; &quot;Offline&quot; means the
              phone did it without signal and sent it later.
            </p>
          </>
        }
      />
      <ErrorMessage message={exportError} />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {/* On a phone the tabs scroll sideways rather than taking three lines. */}
          <div className="-mx-1 max-w-full overflow-x-auto px-1 py-1">
            <div className="w-max">
              <ToggleGroup label="Where it happened" value={view.tab} options={TABS} onChange={(next) => query.set(tabChanges(next))} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <Switch label="Failures only" checked={view.failuresOnly} onChange={(on) => query.set({ [KEY.failures]: on ? "1" : null })} />
            <span title={current ? undefined : "Live needs a period that reaches today."}>
              <Switch label="Live" checked={live && current} disabled={!current} onChange={setLive} />
            </span>
          </div>
        </div>

        <div className={showFilters ? "block" : "hidden sm:block"}>
          <div id="logs-filters" className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
            <FilterMenu {...menuProps(KEY.organization, organizationOptions, chooseRestaurants)} />
            <FilterMenu {...menuProps(KEY.outlet, outletOptions)} />
            <FilterMenu {...menuProps(KEY.person, personOptions)} />
            {ai ? (
              <>
                <FilterMenu {...menuProps(KEY.aiFeature, options(KEY.aiFeature, menu?.aiFeatures))} />
                <FilterMenu {...menuProps(KEY.aiModel, options(KEY.aiModel, menu?.aiModels))} />
                <FilterMenu {...menuProps(KEY.aiStatus, options(KEY.aiStatus, menu?.aiStatuses))} />
                <FilterMenu {...menuProps(KEY.aiOutcome, options(KEY.aiOutcome, menu?.aiOutcomes))} />
              </>
            ) : (
              <>
                <FilterMenu {...menuProps(KEY.area, options(KEY.area, menu?.categories), chooseAreas)} />
                <FilterMenu {...menuProps(KEY.action, actionOptions)} />
                <FilterMenu {...menuProps(KEY.result, options(KEY.result, menu?.results))} />
              </>
            )}
            <Popover label="More filters" count={moreCount} width={340}>
              {(close) => (
                <MoreFilters
                  view={view}
                  ai={ai}
                  roles={options(KEY.role, menu?.roles)}
                  results={options(KEY.result, menu?.results)}
                  recordTypes={menu?.entityTypes ?? []}
                  onList={setList}
                  onSet={(changes) => query.set(changes)}
                  close={close}
                />
              )}
            </Popover>
          </div>
        </div>

        {(chips.length > 0 || view.q) && (
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
              <button type="button" onClick={() => query.set(clearedFilters())} className="cursor-pointer rounded-md px-2 py-1 text-sm font-semibold text-primary hover:underline">
                Clear all
              </button>
            </li>
          </ul>
        )}
      </div>

      <SummaryLine totals={totals} loading={!totals && !failure} live={live && current} checkedAt={checkedAt} />

      {failure && <LoadError message={failure} onRetry={() => setAttempt((n) => n + 1)} />}
      {!rows && !failure && <Loading />}

      {shown && list.length === 0 && (
        <EmptyState
          title={filtered ? "No events match" : "Nothing recorded in this period"}
          action={
            filtered ? (
              <Button variant="secondary" onClick={() => query.set(clearedFilters())}>
                Clear all filters
              </Button>
            ) : undefined
          }
        >
          {filtered ? "Try a longer period or fewer filters." : "Try a longer period."}
        </EmptyState>
      )}

      {list.length > 0 && (
        <div aria-busy={reloading} className={reloading ? "opacity-50" : ""}>
          {/* A computer: one row per event. */}
          <div className="hidden overflow-x-auto rounded-xl border border-border bg-surface md:block">
            <table className="w-full min-w-[54rem] text-left text-sm">
              <caption className="sr-only">Events, newest first. Choose an event to see everything about it.</caption>
              <thead className="border-b border-border text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-2 pl-3 font-medium">
                    Time
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Source
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Who
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Where
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    What
                  </th>
                  <th scope="col" className="py-2 pr-3 pl-2 font-medium">
                    Result
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((entry) => {
                  const bad = isFailure(entry.result);
                  const open = entry.id === eventId;
                  const fresh = rows?.fresh.includes(entry.id);
                  return (
                    <tr
                      key={entry.id}
                      onClick={rowClick(entry)}
                      className={`cursor-pointer border-b border-border align-top last:border-b-0 hover:bg-background ${
                        open ? "bg-primary/10" : bad ? "bg-danger/5" : fresh ? "bg-primary/5" : ""
                      }`}
                    >
                      <td className={`py-2 pr-2 pl-3 text-muted ${bad ? "shadow-[inset_3px_0_0_var(--danger)]" : ""}`}>
                        <Time at={entry.at} />
                      </td>
                      <td className="px-2 py-2">
                        <SourceBadge source={entry.source} short />
                      </td>
                      {/* Names and places stay on one line each, cut short with "…"; the side panel has them in full. */}
                      <td className="px-2 py-2">
                        {people(entry, "block max-w-[11rem] truncate")}
                        {entry.actorRole && <span className="block text-xs text-muted">{ROLE_LABELS[entry.actorRole]}</span>}
                      </td>
                      <td className="px-2 py-2">
                        {restaurant(entry, "block max-w-[12rem] truncate") ?? <span className="text-muted">–</span>}
                        {outlet(entry, "block max-w-[12rem] truncate text-xs")}
                      </td>
                      <td className="px-2 py-2">{what(entry)}</td>
                      <td className="py-2 pr-3 pl-2">
                        <ResultBadge result={entry.result} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* A phone: one card per event, the action first. */}
          <ul className="flex flex-col gap-2 md:hidden">
            {list.map((entry) => {
              const bad = isFailure(entry.result);
              const place = [restaurant(entry), outlet(entry)].filter(Boolean);
              return (
                <li
                  key={entry.id}
                  onClick={rowClick(entry)}
                  className={`cursor-pointer rounded-xl border p-3 ${bad ? "border-danger/50 bg-danger/5" : "border-border bg-surface"} ${entry.id === eventId ? "ring-2 ring-primary" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">{what(entry)}</div>
                    <ResultBadge result={entry.result} />
                  </div>
                  <p className="mt-1 text-sm">
                    {people(entry)}
                    {entry.actorRole && <span className="text-muted"> · {ROLE_LABELS[entry.actorRole]}</span>}
                  </p>
                  {place.length > 0 && (
                    <p className="text-sm">
                      {place[0]}
                      {place[1] && <span className="text-muted"> · </span>}
                      {place[1]}
                    </p>
                  )}
                  <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <Time at={entry.at} />
                    <SourceBadge source={entry.source} />
                  </p>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 flex flex-col items-center gap-2">
            {shown?.nextCursor ? (
              <Button variant="secondary" onClick={() => void loadMore()} loading={more.busy}>
                Load {ACTIVITY_LOG_RULES.pageSize} more
              </Button>
            ) : (
              shown && <p className="text-sm text-muted">That is every event in this period.</p>
            )}
            <ErrorMessage message={more.error} />
          </div>
        </div>
      )}

      <EventPanel
        eventId={eventId}
        base={at >= 0 ? list[at]! : null}
        newer={at > 0 ? list[at - 1]!.id : null}
        older={at >= 0 && at < list.length - 1 ? list[at + 1]!.id : null}
        onClose={panelClosed}
        onOpen={(id) => query.set({ [KEY.event]: id }, "replace")}
        onFilter={filterFromPanel}
      />
    </div>
  );
}

/** A name in a row that filters the page by it when pressed. The dotted line says it can be pressed without shouting. */
function FilterText({ title, onClick, className = "", children }: { title: string; onClick: () => void; className?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`cursor-pointer rounded text-left underline decoration-border-strong decoration-dotted underline-offset-4 hover:text-primary hover:decoration-solid ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * The search box. What is typed shows at once; the address (and so the list) follows
 * a moment after typing stops, or at once on Enter. Back, "Clear all" or a link that
 * changes the search puts the new words in the box.
 */
function SearchBox({ value, onSearch }: { value: string; onSearch: (text: string) => void }) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The address changed from somewhere other than this box: show its words.
  if (value !== seen) {
    setSeen(value);
    if (value !== text.trim()) setText(value);
  }

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const send = (next: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (next.trim() !== value) onSearch(next.trim());
  };

  return (
    // On a phone it takes a line of its own under the period and the buttons.
    <div className="order-last w-full sm:order-none sm:w-72">
      <label className="sr-only" htmlFor="logs-search">
        Search the log
      </label>
      <input
        id="logs-search"
        type="search"
        value={text}
        maxLength={ACTIVITY_LOG_RULES.maxSearchLength}
        placeholder="Person, restaurant, action, ECCS-0042…"
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => send(next), 400);
        }}
        onKeyDown={(event) => event.key === "Enter" && send(text)}
        className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm"
      />
    </div>
  );
}

/** One line for what is filtered: events, failures, people, and the AI calls with their cost when there are any. */
function SummaryLine({ totals, loading, live, checkedAt }: { totals: ActivityLogSummaryDto | null; loading: boolean; live: boolean; checkedAt: string | null }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
      <p role="status" className="text-muted">
        {totals ? (
          <>
            <strong className="text-foreground">{plural(totals.events, "event")}</strong>
            {" · "}
            <span
              title={`${totals.refused} refused, ${totals.rejected} rejected, ${totals.failed} failed`}
              className={totals.failures > 0 ? "font-semibold text-danger" : ""}
            >
              {plural(totals.failures, "failure")}
            </span>
            {" · "}
            {plural(totals.people, "person", "people")}
            {totals.aiCalls > 0 && (
              <>
                {" · "}
                {plural(totals.aiCalls, "AI call")}, {usd(totals.aiCostUsd)}
              </>
            )}
          </>
        ) : loading ? (
          "Loading…"
        ) : null}
      </p>
      {live && (
        <p className="text-xs text-muted">
          <span aria-hidden className="mr-1 text-primary">
            ●
          </span>
          Live{checkedAt ? `, checked ${new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(checkedAt))}` : ""}
        </p>
      )}
    </div>
  );
}

/** The filters used less often, in one panel: role, the record, device or IP, done offline (and the result, under the AI tab). */
function MoreFilters({
  view,
  ai,
  roles,
  results,
  recordTypes,
  onList,
  onSet,
  close,
}: {
  view: LogView;
  ai: boolean;
  roles: MenuOption[];
  results: MenuOption[];
  recordTypes: { value: string; label: string; count: number }[];
  onList: (key: ListKey, values: string[]) => void;
  onSet: (changes: Record<string, string | null>) => void;
  close: () => void;
}) {
  const [reference, setReference] = useState(view.reference);
  const [deviceOrIp, setDeviceOrIp] = useState(view.ip || view.device);

  const ticks = (key: ListKey, title: string, choices: MenuOption[]) => {
    const chosen = view.lists[key];
    const all = [...chosen.filter((value) => !choices.some((c) => c.value === value)).map((value) => ({ value, label: value, count: 0 })), ...choices];
    return (
      <fieldset>
        <legend className="mb-1 font-semibold">{title}</legend>
        {all.length === 0 && <p className="text-muted">Nothing in this period.</p>}
        <div className="flex flex-col">
          {all.map((option) => (
            <label key={option.value} className="flex cursor-pointer items-center gap-2.5 rounded px-1 py-1 hover:bg-background">
              <input
                type="checkbox"
                checked={chosen.includes(option.value)}
                onChange={(event) => onList(key, event.target.checked ? [...chosen, option.value] : chosen.filter((v) => v !== option.value))}
                className="h-4 w-4 accent-primary"
              />
              <span className="flex-1">{option.label}</span>
              <span className="text-xs text-muted tabular-nums">{option.count.toLocaleString("en-IN")}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  };

  function applyText() {
    const typed = deviceOrIp.trim();
    onSet({
      [KEY.reference]: reference.trim() || null,
      [KEY.ip]: typed && looksLikeIp(typed) ? typed : null,
      [KEY.device]: typed && !looksLikeIp(typed) ? typed : null,
    });
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-3">
        {ticks(KEY.role, "Role", roles)}
        {ai && ticks(KEY.result, "Result", results)}
        <div className="flex flex-col gap-1">
          <label htmlFor="logs-record" className="font-semibold">
            Record
          </label>
          <select
            id="logs-record"
            value={view.record}
            onChange={(event) => onSet({ [KEY.record]: event.target.value || null, [KEY.recordId]: null })}
            className="rounded-lg border border-border-strong bg-surface px-3 py-2"
          >
            <option value="">Any kind of record</option>
            {view.record && !recordTypes.some((type) => type.value === view.record) && <option value={view.record}>{entityLabel(view.record)}</option>}
            {recordTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {entityLabel(type.value)} ({type.count.toLocaleString("en-IN")})
              </option>
            ))}
          </select>
        </div>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            applyText();
            close();
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="logs-reference" className="font-semibold">
              Reference
            </label>
            <input
              id="logs-reference"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="ECCS-0042, IR-2026-00012, an invoice number"
              maxLength={60}
              className="rounded-lg border border-border-strong px-3 py-2"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="logs-device" className="font-semibold">
              Device or IP
            </label>
            <input
              id="logs-device"
              value={deviceOrIp}
              onChange={(event) => setDeviceOrIp(event.target.value)}
              placeholder="An IP address or a linked phone's id"
              maxLength={64}
              className="rounded-lg border border-border-strong px-3 py-2"
            />
          </div>
          <Button type="submit" size="sm" variant="secondary" className="self-start">
            Apply
          </Button>
        </form>
        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={view.offline}
            onChange={(event) => onSet({ [KEY.offline]: event.target.checked ? "1" : null })}
            className="h-4 w-4 accent-primary"
          />
          <span>
            <span className="font-semibold">Done offline</span>
            <span className="block text-xs text-muted">Done on a phone without signal and sent later</span>
          </span>
        </label>
      </div>
      <div className="flex justify-end border-t border-border px-2 py-1.5">
        <button type="button" onClick={close} className="cursor-pointer rounded-md px-3 py-1 font-semibold hover:bg-background">
          Done
        </button>
      </div>
    </div>
  );
}
