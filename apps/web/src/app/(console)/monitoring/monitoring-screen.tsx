"use client";

import {
  can,
  MONITORING_AREAS,
  MONITORING_DEFAULT_DAYS,
  MONITORING_RULES,
  type InspectionGrade,
  type IssueCategory,
  type LicenceType,
  type MonitoringArea,
  type MonitoringBoardDto,
  type MonitoringInspectionProblem,
  type MonitoringLevel,
  type MonitoringOutletDto,
  type MonitoringVisitItemDto,
  type MonitoringVisitProblem,
} from "@eccs/shared";
import Link from "next/link";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";

import { MasterDetail } from "@/components/master-detail";
import { Button, Card, ErrorMessage, Field, Loading, ToggleGroup } from "@/components/ui";
import { api } from "@/lib/api";
import { describe, english, longDay, matchesSearch, shortDay } from "@/lib/format";
import { isPlainClick, useQuery, useQueryField } from "@/lib/query";
import { useSession } from "@/lib/session";

// ───────────────────────── Words ─────────────────────────

/**
 * How each level is shown. Colour is never the only sign: every level has its
 * own mark and its own words, so the board reads the same in black and white
 * and to someone who cannot tell red from green.
 */
const LEVEL: Record<MonitoringLevel, { label: string; mark: string; markStyle: string; badgeStyle: string }> = {
  ATTENTION: { label: "Needs attention", mark: "!", markStyle: "bg-danger text-white", badgeStyle: "border-danger bg-danger text-white" },
  WATCH: { label: "Watch", mark: "▲", markStyle: "border border-foreground text-foreground", badgeStyle: "border-foreground text-foreground" },
  OK: { label: "On track", mark: "✓", markStyle: "border border-primary text-primary", badgeStyle: "border-primary text-primary" },
  NONE: { label: "Nothing yet", mark: "–", markStyle: "border border-border-strong text-muted", badgeStyle: "border-border-strong text-muted" },
};

const AREA: Record<MonitoringArea, string> = {
  checklists: "Checklists",
  issues: "Issues",
  licences: "Licences",
  visits: "Visits",
  inspections: "Inspections",
  score: "Hygiene score",
};

const GRADE: Record<InspectionGrade, string> = {
  A_PLUS: "A+ · Exemplary",
  A: "A · Satisfactory",
  B: "B · Needs improvement",
  NON_COMPLIANT: "No grade · Not compliant",
};

const CATEGORY: Record<IssueCategory, string> = {
  PEST_SIGHTING: "Pest sighting",
  CHIMNEY: "Chimney or exhaust",
  EQUIPMENT: "Equipment",
  HYGIENE: "Cleaning or hygiene",
  SUPPORT: "Help with the app or service",
  OTHER: "Something else",
};

const LICENCE: Record<LicenceType, string> = {
  FSSAI: "FSSAI licence",
  FIRE_NOC: "Fire NOC",
  TRADE_LICENCE: "Trade licence",
  PEST_CONTROL: "Pest control contract",
  OTHER: "Licence",
};

const INSPECTION_PROBLEM: Record<MonitoringInspectionProblem, string> = {
  NO_GRADE: "Ended with no grade",
  REPORT_TO_APPROVE: "Report waiting for ECCS to approve",
  OVERDUE_PLANNED: "Planned day has passed, not finished",
};

/** "1 visit", "3 visits". */
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "today", "for 1 day", "for 4 days". */
const waited = (days: number | null) => (days === null ? "" : days <= 0 ? "since today" : `for ${count(days, "day")}`);

/** What is wrong with one visit, in words. */
function visitProblem(problem: MonitoringVisitProblem, visit: MonitoringVisitItemDto) {
  switch (problem) {
    case "OVERDUE":
      return `Overdue ${waited(visit.waitingDays)}`.trim();
    case "UNASSIGNED":
      return "No Supervisor yet";
    case "AWAITING_SIGN_OFF":
      return `Waiting for the restaurant's sign-off ${waited(visit.waitingDays)}`.trim();
    case "REPORT_TO_APPROVE":
      return `Report waiting for ECCS to approve ${waited(visit.waitingDays)}`.trim();
    case "REPORT_RETURNED":
      return "Report sent back to the Supervisor";
    case "LOW_RATING":
      return `Rated ${visit.rating ?? "low"} out of 5 by the restaurant`;
  }
}

/**
 * What one cell of the table says: the main fact, and anything else worth
 * knowing underneath. Always words or numbers, so the cell means something
 * without its mark.
 */
function cellText(outlet: MonitoringOutletDto, area: MonitoringArea): { main: string; more: string[] } {
  switch (area) {
    case "checklists": {
      const c = outlet.checklists;
      if (c.due === 0) return { main: "None due", more: [] };
      return {
        main: `${c.submitted} of ${c.due} handed in`,
        more: [c.missed > 0 && `${c.missed} missed`, c.late > 0 && `${c.late} late`, c.withProblems > 0 && `${c.withProblems} with problems`].filter(isText),
      };
    }
    case "issues": {
      const i = outlet.issues;
      if (i.unresolved === 0) return { main: "None open", more: [] };
      return {
        main: `${i.unresolved} open`,
        more: [
          i.notStarted > 0 && `${i.notStarted} not picked up`,
          i.oldestUnresolvedDays !== null && i.oldestUnresolvedDays > 0 && `oldest ${count(i.oldestUnresolvedDays, "day")}`,
        ].filter(isText),
      };
    }
    case "licences": {
      const l = outlet.licences;
      if (l.total === 0) return { main: "None on file", more: [] };
      if (l.expired > 0) return { main: `${l.expired} expired`, more: l.expiring > 0 ? [`${l.expiring} expiring`] : [] };
      if (l.expiring > 0) {
        const soonest = Math.min(...l.items.map((licence) => licence.daysLeft));
        return { main: `${l.expiring} expiring`, more: [soonest === 0 ? "soonest today" : `soonest in ${count(soonest, "day")}`] };
      }
      return { main: "All valid", more: [] };
    }
    case "visits": {
      const v = outlet.visits;
      const waiting = [
        v.overdue > 0 && `${v.overdue} overdue`,
        v.unassigned > 0 && `${v.unassigned} with no Supervisor`,
        v.awaitingSignOff > 0 && `${v.awaitingSignOff} waiting for sign-off`,
        v.reportsToApprove > 0 && `${count(v.reportsToApprove, "report")} to approve`,
        v.reportsReturned > 0 && `${count(v.reportsReturned, "report")} sent back`,
        v.lowRatings > 0 && count(v.lowRatings, "low rating"),
      ].filter(isText);
      const [main = "Nothing waiting", ...rest] = waiting;
      return {
        main,
        more: [
          ...rest,
          v.ratingAverage !== null && `rated ${v.ratingAverage} out of 5 (${count(v.ratingCount, "rating")})`,
          v.nextDate !== null && `next ${shortDay(v.nextDate)}`,
        ].filter(isText),
      };
    }
    case "inspections": {
      const n = outlet.inspections;
      return {
        main: n.latest ? `${n.latest.score} out of 100 · ${GRADE[n.latest.grade]}` : "Not yet inspected",
        more: [
          n.toApprove > 0 && `${count(n.toApprove, "report")} to approve`,
          n.overduePlanned > 0 && `${n.overduePlanned} planned, not done`,
        ].filter(isText),
      };
    }
    case "score": {
      const s = outlet.score;
      if (s.score === null) return { main: "Not yet scored", more: [] };
      return { main: `${s.score} out of 100`, more: s.change === null ? [] : [changeText(s.change)] };
    }
  }
}

const isText = (value: string | false): value is string => value !== false;

/** The change in the score with its direction in words and a sign, never by colour alone. */
const changeText = (change: number) =>
  change === 0 ? "no change in a week" : change > 0 ? `up ${change} in a week` : `down ${Math.abs(change)} in a week`;

// ───────────────────────── Filters and order ─────────────────────────

/** What the strip of counts filters by. Kept in the web address as `show=`. */
const SHOW = ["all", "attention", "watch", ...MONITORING_AREAS] as const;
type Show = (typeof SHOW)[number];

/** What the table is ordered by. Kept in the web address as `sort=`, with `dir=desc` to turn it round. */
const SORT = ["status", "outlet", ...MONITORING_AREAS] as const;
type Sort = (typeof SORT)[number];

const PERIODS = ["7", "14", "30"] as const;

const LEVEL_ORDER: Record<MonitoringLevel, number> = { ATTENTION: 0, WATCH: 1, OK: 2, NONE: 3 };

/** Within the same level, which outlet is worse in an area: the bigger number comes first. */
const SEVERITY: Record<MonitoringArea, (outlet: MonitoringOutletDto) => number> = {
  checklists: (o) => 100 - (o.checklists.percent ?? 100),
  issues: (o) => (o.issues.oldestUnresolvedDays ?? -1) + o.issues.unresolved / 100,
  licences: (o) => o.licences.expired * 100 + o.licences.expiring,
  visits: (o) => o.visits.overdue * 100 + o.visits.items.length,
  inspections: (o) => 100 - (o.inspections.latest?.score ?? 100),
  score: (o) => 100 - (o.score.score ?? 100),
};

const fullName = (outlet: MonitoringOutletDto) => `${outlet.organizationName} · ${outlet.outletName}`;

function matchesShow(outlet: MonitoringOutletDto, show: Show) {
  if (show === "all") return true;
  if (show === "attention") return outlet.level === "ATTENTION";
  if (show === "watch") return outlet.level === "WATCH";
  // An area's filter keeps every outlet with something to act on or to watch there.
  return outlet.attention.includes(show) || outlet.watch.includes(show);
}

// ───────────────────────── Small pieces ─────────────────────────

/** The mark for a level, with the level's name for screen readers. */
function LevelMark({ level }: { level: MonitoringLevel }) {
  return (
    <>
      <span
        aria-hidden
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs leading-none font-bold ${LEVEL[level].markStyle}`}
      >
        {LEVEL[level].mark}
      </span>
      <span className="sr-only">{LEVEL[level].label}: </span>
    </>
  );
}

function LevelBadge({ level }: { level: MonitoringLevel }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${LEVEL[level].badgeStyle}`}>
      <span aria-hidden>{LEVEL[level].mark}</span>
      {LEVEL[level].label}
    </span>
  );
}

/** "Needs attention: Issues, Licences. Watch: Checklists." */
function reasons(outlet: MonitoringOutletDto) {
  const names = (areas: MonitoringArea[]) => areas.map((area) => AREA[area]).join(", ");
  return [
    outlet.attention.length > 0 && `Needs attention: ${names(outlet.attention)}`,
    outlet.watch.length > 0 && `Watch: ${names(outlet.watch)}`,
  ]
    .filter(isText)
    .join(" · ");
}

/** One count of the strip above the table. Pressing it filters the table to those outlets. */
function CountTile({
  label,
  number,
  note,
  pressed,
  alarming,
  onPress,
}: {
  label: string;
  number: number;
  note?: string;
  pressed: boolean;
  /** True when the number counts something that needs attention and is not zero. */
  alarming?: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onPress}
      className={`flex min-w-28 flex-1 cursor-pointer flex-col items-start rounded-xl border bg-surface px-4 py-3 text-left hover:border-primary ${
        pressed ? "border-primary ring-2 ring-primary" : "border-border-strong"
      }`}
    >
      <span className="text-sm font-semibold text-muted">{label}</span>
      <span className={`text-2xl font-bold ${alarming ? "text-danger" : ""}`}>{number}</span>
      {note && <span className="text-xs text-muted">{note}</span>}
    </button>
  );
}

// ───────────────────────── The screen ─────────────────────────

/**
 * The monitoring board: every client outlet at a glance, worst first, so the
 * office knows whom to call today. A strip of counts at the top doubles as
 * filters; under it a table has one row per outlet and one column per area
 * (checklists, issues, licences, visits, inspections, hygiene score). Choosing
 * an outlet opens what is behind its numbers, each problem with a link to the
 * page where it is dealt with. Nothing is changed from here.
 *
 * What is being looked at lives in the web address: `days=` for how far back,
 * `show=` for the filter, `q=` for the search, `sort=` and `dir=` for the
 * order, and `outlet=` for the outlet that is open.
 */
export default function MonitoringScreen() {
  const query = useQuery();
  const { user } = useSession();
  // Super Admins and Operations Managers see every outlet; a Supervisor only those they work at.
  const admin = user ? can(user.memberships, "clients", "create") : false;

  const askedDays = query.get("days");
  const days = (PERIODS as readonly string[]).includes(askedDays) ? askedDays : String(MONITORING_DEFAULT_DAYS);
  const askedShow = query.get("show") as Show;
  const show: Show = SHOW.includes(askedShow) ? askedShow : "all";
  const askedSort = query.get("sort") as Sort;
  const sort: Sort = SORT.includes(askedSort) ? askedSort : "status";
  const reversed = query.get("dir") === "desc";
  const [search, setSearch] = useQueryField("q");
  const outletId = query.get("outlet");

  // Kept with the period it was fetched for, so changing the period never shows the other period's numbers.
  const [loaded, setLoaded] = useState<{ days: string; board: MonitoringBoardDto } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Raised to fetch the board again. */
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.monitoring
      .board({ days: Number(days) })
      .then((board) => {
        if (cancelled) return;
        setLoaded({ days, board });
        setError(null);
      })
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [days, version]);

  const board = loaded && loaded.days === days ? loaded.board : null;
  const all = board?.outlets ?? [];
  const found = all.filter((outlet) => matchesSearch(search, [outlet.organizationName, outlet.outletName]));
  const matching = found.filter((outlet) => matchesShow(outlet, show));

  // The server sends the worst outlets first, and that is the order unless a column is chosen.
  const shown = [...matching];
  if (sort === "outlet") shown.sort((a, b) => fullName(a).localeCompare(fullName(b)));
  else if (sort !== "status") {
    shown.sort((a, b) => LEVEL_ORDER[a[sort].level] - LEVEL_ORDER[b[sort].level] || SEVERITY[sort](b) - SEVERITY[sort](a));
  }
  if (reversed) shown.reverse();

  const open = outletId ? (all.find((outlet) => outlet.outletId === outletId) ?? null) : null;

  /** Pressing the column that is already chosen turns the order round; another column starts worst first (or A to Z). */
  const sortBy = (column: Sort) =>
    query.set({ sort: column === "status" ? null : column, dir: column === sort && !reversed ? "desc" : null }, "replace");

  const outletLink = (outlet: MonitoringOutletDto) => ({
    href: query.hrefWith({ outlet: outlet.outletId }),
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (!isPlainClick(event)) return;
      event.preventDefault();
      if (outlet.outletId !== outletId) query.set({ outlet: outlet.outletId });
    },
  });

  const nothingMatches = board && all.length > 0 && shown.length === 0;
  const status = (
    <>
      {error && (
        <div className="flex flex-col items-start gap-3">
          <ErrorMessage message={error} />
          <Button variant="secondary" onClick={() => setVersion((current) => current + 1)}>
            Try again
          </Button>
        </div>
      )}
      {!board && !error && <Loading />}
      {board && all.length === 0 && (
        <p className="text-muted">{admin ? "No outlets yet." : "No outlets yet: you will see the outlets where you have visits or inspections."}</p>
      )}
      {nothingMatches && (
        <p role="status" className="text-sm text-muted">
          No outlets match. Clear the search or choose &quot;All outlets&quot;.
        </p>
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Monitoring</h1>
          <p className="text-muted">
            {admin ? "Every client outlet" : "The outlets you work at"}, worst first: who is falling behind, and on what.
            {board && ` Checklists and ratings cover ${shortDay(board.from)} to ${shortDay(board.to)}; everything else is as it stands now.`}
          </p>
        </div>
        <Button variant="secondary" onClick={() => setVersion((current) => current + 1)}>
          Refresh
        </Button>
      </div>

      {/* On a narrow screen an open outlet takes the place of the counts and filters as well as the list. */}
      <div className={`flex-col gap-4 ${open ? "hidden lg:flex" : "flex"}`}>
        {board && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Counts. Press one to show only those outlets.">
            <CountTile label="All outlets" number={board.totals.outlets} pressed={show === "all"} onPress={() => query.set({ show: null }, "replace")} />
            <CountTile
              label="Need attention"
              number={board.totals.attention}
              alarming={board.totals.attention > 0}
              pressed={show === "attention"}
              // Pressing the one that is on turns the filter off again.
              onPress={() => query.set({ show: show === "attention" ? null : "attention" }, "replace")}
            />
            <CountTile
              label="To watch"
              number={board.totals.watch}
              pressed={show === "watch"}
              onPress={() => query.set({ show: show === "watch" ? null : "watch" }, "replace")}
            />
            {MONITORING_AREAS.map((area) => (
              <CountTile
                key={area}
                label={AREA[area]}
                number={board.totals.areas[area].attention}
                alarming={board.totals.areas[area].attention > 0}
                note={`need attention · ${board.totals.areas[area].watch} to watch`}
                pressed={show === area}
                onPress={() => query.set({ show: show === area ? null : area }, "replace")}
              />
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-end justify-between gap-4">
          <Field
            label="Search"
            plainLabel
            type="search"
            placeholder="Restaurant or outlet"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            wrapperClassName="w-full sm:w-72"
          />
          <ToggleGroup
            label="How far back checklists and ratings are counted"
            value={days as (typeof PERIODS)[number]}
            options={PERIODS.map((value) => ({ value, label: `Last ${value} days` }))}
            onChange={(value) => query.set({ days: value === String(MONITORING_DEFAULT_DAYS) ? null : value }, "replace")}
          />
        </div>
        {board && (
          <p role="status" className="text-sm text-muted">
            Showing {shown.length} of {count(all.length, "outlet")}
            {show === "attention" ? " · needing attention" : show === "watch" ? " · to watch" : show !== "all" ? ` · with something to act on or watch in ${AREA[show]}` : ""}
          </p>
        )}
      </div>

      {open ? (
        <MasterDetail
          detail={<OutletDetail outlet={open} admin={admin} days={Number(days)} />}
          detailLabel="Outlet details"
          placeholder="Select an outlet to see what is behind its numbers."
          backHref={query.hrefWith({ outlet: null })}
          onBack={() => query.set({ outlet: null })}
          list={
            <>
              <a
                href={query.hrefWith({ outlet: null })}
                onClick={(event) => {
                  if (!isPlainClick(event)) return;
                  event.preventDefault();
                  query.set({ outlet: null });
                }}
                className="self-start rounded-md px-2 py-1 font-semibold text-primary hover:underline"
              >
                ← Back to the full table
              </a>
              {status}
              <ul className="flex flex-col gap-2">
                {shown.map((outlet) => {
                  const selected = outlet.outletId === outletId;
                  return (
                    <li key={outlet.outletId}>
                      <a
                        {...outletLink(outlet)}
                        aria-current={selected ? "true" : undefined}
                        className={`block rounded-xl border bg-surface p-4 hover:border-primary ${
                          selected ? "border-primary ring-2 ring-primary" : "border-border"
                        }`}
                      >
                        <span className="flex items-start justify-between gap-3">
                          <span className="font-semibold">{fullName(outlet)}</span>
                          <LevelBadge level={outlet.level} />
                        </span>
                        <span className="mt-1 block text-sm text-muted">{reasons(outlet) || "Nothing to do"}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </>
          }
        />
      ) : (
        <>
          {status}
          {outletId && board && <ErrorMessage message="That outlet is not on your board." />}
          {shown.length > 0 && (
            <Card className="overflow-x-auto p-0">
              <table className="w-full min-w-[64rem] text-left text-sm">
                <caption className="sr-only">Outlets and how each is doing, one column per area. Column headings sort the table.</caption>
                <thead className="border-b border-border text-muted">
                  <tr>
                    <SortHeader label="Outlet" column="outlet" sort={sort} reversed={reversed} onSort={sortBy} first="A to Z" second="Z to A" />
                    <SortHeader label="Overall" column="status" sort={sort} reversed={reversed} onSort={sortBy} />
                    {MONITORING_AREAS.map((area) => (
                      <SortHeader key={area} label={AREA[area]} column={area} sort={sort} reversed={reversed} onSort={sortBy} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((outlet) => (
                    <tr key={outlet.outletId} className="border-b border-border align-top last:border-b-0 hover:bg-background">
                      <th scope="row" className="px-4 py-3 font-normal">
                        <a {...outletLink(outlet)} className="font-semibold text-primary hover:underline">
                          {outlet.outletName}
                        </a>
                        <span className="block text-muted">{outlet.organizationName}</span>
                        <span className="block text-xs text-muted">{outlet.plan ? `${english(outlet.plan.name)} plan` : "No plan"}</span>
                      </th>
                      <td className="px-3 py-3">
                        <LevelBadge level={outlet.level} />
                      </td>
                      {MONITORING_AREAS.map((area) => {
                        const text = cellText(outlet, area);
                        const level = outlet[area].level;
                        return (
                          <td key={area} className="px-3 py-3">
                            <span className="flex items-start gap-2">
                              <LevelMark level={level} />
                              <span>
                                <span className={`block ${level === "ATTENTION" ? "font-semibold text-danger" : level === "NONE" ? "text-muted" : ""}`}>
                                  {text.main}
                                </span>
                                {text.more.map((line) => (
                                  <span key={line} className="block text-xs text-muted">
                                    {line}
                                  </span>
                                ))}
                              </span>
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          <Rules />
        </>
      )}
    </div>
  );
}

/** A column heading that orders the table when pressed, and says how it is ordered. */
function SortHeader({
  label,
  column,
  sort,
  reversed,
  onSort,
  first = "worst first",
  second = "best first",
}: {
  label: string;
  column: Sort;
  sort: Sort;
  reversed: boolean;
  onSort: (column: Sort) => void;
  /** The order the first press gives, and the order a second press gives. */
  first?: string;
  second?: string;
}) {
  const active = sort === column;
  return (
    <th scope="col" aria-sort={active ? (reversed ? "descending" : "ascending") : undefined} className="px-1 py-1 font-medium whitespace-nowrap">
      <button
        type="button"
        onClick={() => onSort(column)}
        title={active ? `Ordered ${reversed ? second : first}. Press to turn round.` : `Order by ${label.toLowerCase()}, ${first}`}
        className={`flex cursor-pointer items-center gap-1 rounded-md px-2 py-2 hover:text-foreground ${active ? "font-bold text-foreground" : ""}`}
      >
        {label}
        <span aria-hidden>{active ? (reversed ? "↑" : "↓") : "↕"}</span>
        {active && <span className="sr-only">, ordered {reversed ? second : first}</span>}
      </button>
    </th>
  );
}

/** The rules behind the marks, in plain words, read from the same numbers the server uses. */
function Rules() {
  const r = MONITORING_RULES;
  return (
    <details className="rounded-xl border border-border bg-surface p-5 text-sm">
      <summary className="cursor-pointer font-semibold">How each area is judged</summary>
      <p className="mt-3 text-muted">
        Each area is marked <LevelBadge level="ATTENTION" /> when someone should act today, <LevelBadge level="WATCH" /> when it is waiting on
        someone or heading the wrong way, <LevelBadge level="OK" /> when there is nothing to do and <LevelBadge level="NONE" /> when nothing has
        been recorded yet. An outlet is as bad as its worst area.
      </p>
      <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-[10rem_1fr]">
        <dt className="font-semibold">Checklists</dt>
        <dd>
          Needs attention when fewer than {r.checklists.attentionBelowPercent}% of the daily checklists due in the period were handed in. Watch
          when fewer than {r.checklists.watchBelowPercent}% were, or any was handed in late. Problems a restaurant notes on its own checklists
          are counted but do not change the mark.
        </dd>
        <dt className="font-semibold">Issues</dt>
        <dd>
          Needs attention when an issue has waited more than {r.issues.notStartedAttentionDays} days without ECCS picking it up, or is still
          unresolved after more than {r.issues.unresolvedAttentionDays} days. Watch while any issue is unresolved.
        </dd>
        <dt className="font-semibold">Licences</dt>
        <dd>Needs attention when a licence has expired. Watch when one expires within {r.licences.expiringWithinDays} days.</dd>
        <dt className="font-semibold">Visits</dt>
        <dd>
          Needs attention when a visit is overdue, a visit due within {r.visits.unassignedAttentionWithinDays} days has no Supervisor, a finished
          visit has waited more than {r.visits.signOffAttentionDays} days for the restaurant&apos;s sign-off, a report has waited more than{" "}
          {r.visits.approvalAttentionDays} days for ECCS&apos;s approval, or the restaurant rated a visit {r.visits.lowRatingStars} stars or
          fewer in the period. Watch when anything else is waiting, or the average rating is below {r.visits.watchAverageBelow}.
        </dd>
        <dt className="font-semibold">Inspections</dt>
        <dd>
          Needs attention when the latest approved inspection ended with no grade, or a report
          has waited more than {r.inspections.approvalAttentionDays} days for approval. Watch when the latest grade is B, a report is waiting for
          approval, or a planned inspection&apos;s day has passed.
        </dd>
        <dt className="font-semibold">Hygiene score</dt>
        <dd>
          Needs attention when the score is below {r.score.attentionBelow}, or has fallen {r.score.attentionDrop} points or more in about a week.
          Watch when it is below {r.score.watchBelow}, or has fallen {r.score.watchDrop} points or more.
        </dd>
      </dl>
    </details>
  );
}

// ───────────────────────── One outlet ─────────────────────────

/** One area of the open outlet: its mark, what it says, and what is behind it. */
function AreaSection({ outlet, area, children }: { outlet: MonitoringOutletDto; area: MonitoringArea; children?: ReactNode }) {
  const text = cellText(outlet, area);
  return (
    <section className="border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">{AREA[area]}</h3>
        <LevelBadge level={outlet[area].level} />
      </div>
      <p className="mt-1">{[text.main, ...text.more].join(" · ")}</p>
      {children}
    </section>
  );
}

const LINK_STYLE = "font-semibold text-primary hover:underline";

/**
 * What is behind an outlet's numbers. Every problem that can be dealt with in
 * the console links to the page where that is done; the rest say whom to call.
 */
function OutletDetail({ outlet, admin, days }: { outlet: MonitoringOutletDto; admin: boolean; days: number }) {
  const { checklists, issues, licences, visits, inspections, score } = outlet;
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-lg font-bold">{fullName(outlet)}</h2>
          <LevelBadge level={outlet.level} />
        </div>
        <p className="text-sm text-muted">{outlet.plan ? `On the ${english(outlet.plan.name)} plan` : "Not on a plan"}</p>
        <p className="mt-1 text-sm">{reasons(outlet) || "Nothing to do here today."}</p>
      </div>

      <AreaSection outlet={outlet} area="checklists">
        <p className="mt-1 text-sm text-muted">
          The restaurant&apos;s own daily checklists over the last {count(days, "day")}.
          {checklists.overdueNow > 0 && ` ${count(checklists.overdueNow, "checklist")} due today ${checklists.overdueNow === 1 ? "is" : "are"} past the time and not handed in.`}
          {checklists.missed > 0 && " There is nothing to do in the console: call the Manager or Owner."}
        </p>
      </AreaSection>

      <AreaSection outlet={outlet} area="issues">
        {issues.items.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {issues.items.map((issue) => (
              <li key={issue.id}>
                <Link href={`/issues?issue=${issue.id}`} className={LINK_STYLE}>
                  {issue.reference}
                </Link>{" "}
                · {CATEGORY[issue.category]} · {issue.status === "OPEN" ? "not picked up yet" : "in progress"} ·{" "}
                {issue.ageDays === 0 ? "raised today" : `raised ${count(issue.ageDays, "day")} ago`}
              </li>
            ))}
          </ul>
        )}
      </AreaSection>

      <AreaSection outlet={outlet} area="licences">
        {licences.items.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {licences.items.map((licence) => (
              <li key={licence.id}>
                {licence.name ?? LICENCE[licence.type]} ·{" "}
                {licence.daysLeft < 0
                  ? `expired ${count(-licence.daysLeft, "day")} ago (${longDay(licence.expiresOn)})`
                  : licence.daysLeft === 0
                    ? "expires today"
                    : `expires in ${count(licence.daysLeft, "day")} (${longDay(licence.expiresOn)})`}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-sm">
          <Link href={`/licences?outlet=${outlet.outletId}`} className={LINK_STYLE}>
            Open this outlet&apos;s licences
          </Link>
        </p>
      </AreaSection>

      <AreaSection outlet={outlet} area="visits">
        {visits.items.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {visits.items.map((visit) => {
              // A visit that is only here for its rating is finished with, so it is on the Visits page's "Finished" list.
              const finished = visit.problems.every((problem) => problem === "LOW_RATING");
              return (
                <li key={visit.id}>
                  <Link href={`/visits?${finished ? "state=closed&" : ""}visit=${visit.id}`} className={LINK_STYLE}>
                    {english(visit.serviceName)}, {shortDay(visit.date)}
                  </Link>{" "}
                  · {visit.problems.map((problem) => visitProblem(problem, visit)).join(" · ")}
                </li>
              );
            })}
          </ul>
        )}
        {visits.awaitingSignOff > 0 && <p className="mt-2 text-sm text-muted">Sign-off is done by the Owner or Manager in their app: call them.</p>}
      </AreaSection>

      <AreaSection outlet={outlet} area="inspections">
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {inspections.latest && (
            <li>
              <Link href={`/inspections?inspection=${inspections.latest.id}`} className={LINK_STYLE}>
                Latest report{inspections.latest.reportNumber ? ` ${inspections.latest.reportNumber}` : ""}, {shortDay(inspections.latest.date)}
              </Link>
              {inspections.actionsOpen > 0 &&
                ` · ${count(inspections.actionsOpen, "corrective action")} on the report`}
            </li>
          )}
          {inspections.items
            .filter((item) => item.id !== inspections.latest?.id)
            .map((item) => (
              <li key={item.id}>
                <Link href={`/inspections?inspection=${item.id}`} className={LINK_STYLE}>
                  Inspection, {shortDay(item.date)}
                </Link>{" "}
                · {item.problems.map((problem) => INSPECTION_PROBLEM[problem]).join(" · ")}
              </li>
            ))}
          {!inspections.latest && admin && (
            <li>
              <Link href="/inspections?new=1" className={LINK_STYLE}>
                Plan an inspection
              </Link>
            </li>
          )}
        </ul>
      </AreaSection>

      <AreaSection outlet={outlet} area="score">
        <p className="mt-1 text-sm text-muted">
          {score.score === null
            ? "The hygiene score is worked out once a day. This outlet has none yet."
            : `As of ${score.date ? longDay(score.date) : "today"}.${
                score.previous !== null && score.previousDate ? ` It was ${score.previous} on ${longDay(score.previousDate)}.` : " There is no earlier score to compare with yet."
              }`}
        </p>
      </AreaSection>
    </Card>
  );
}
