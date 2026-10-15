"use client";

import type { GrowthWeekDto } from "@eccs/shared";

import { axisLabel, money, scale } from "../finance/finance-parts";
import { LINE } from "./sales-parts";

// The Sales page's two growth charts (15 Oct 2026), drawn like the Finance page's: plain
// HTML and CSS with one small SVG, no chart library. Each says what it shows in words
// beside it, resting the mouse on a week shows its figures, and a hidden table gives a
// screen reader the same numbers. One scale each (never two axes on one chart): the
// counts on the left chart, rupees on the right.

const shortDay = (date: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${date}T00:00:00Z`));

/**
 * Paying kitchens and people using the app, week by week, each line carried on dotted to
 * where the last two weeks' pace lands by the forecast day. Both lines are named at their
 * ends, so the colour is never the only key.
 */
export function GrowthLines({ weeks, forecast, forecastDate }: { weeks: readonly GrowthWeekDto[]; forecast: { payingKitchens: number; people: number }; forecastDate: string }) {
  if (weeks.length === 0) return <p className="text-sm text-muted">No weeks yet.</p>;
  const top = Math.max(4, ...weeks.flatMap((week) => [week.payingKitchens, week.people]), forecast.payingKitchens, forecast.people) * 1.15;
  // The weeks take the first four fifths of the width; the forecast day sits at the right edge.
  const span = 80;
  const x = (index: number) => (weeks.length === 1 ? span / 2 : (index / (weeks.length - 1)) * span);
  const y = (value: number) => 92 - (value / top) * 84;
  const last = weeks.length - 1;
  const series = [
    { key: "people" as const, label: "People using the app", color: LINE.people, end: forecast.people, unit: (n: number) => `${n} ${n === 1 ? "person" : "people"}` },
    { key: "payingKitchens" as const, label: "Paying kitchens", color: LINE.kitchens, end: forecast.payingKitchens, unit: (n: number) => `${n} ${n === 1 ? "kitchen" : "kitchens"}` },
  ];
  return (
    <figure className="flex flex-col gap-2">
      <div className="relative h-44" aria-hidden>
        {[0.25, 0.5, 0.75].map((share) => (
          <div key={share} className="absolute inset-x-0 border-t border-border" style={{ top: `${y(top * share)}%` }} />
        ))}
        <div className="absolute inset-x-0 border-t border-border-strong" style={{ top: `${y(0)}%` }} />
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
          {series.map((line) => (
            <g key={line.key}>
              <path
                d={weeks.map((week, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(week[line.key])}`).join(" ")}
                fill="none"
                stroke={line.color}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
              <path d={`M${x(last)},${y(weeks[last]![line.key])} L100,${y(line.end)}`} fill="none" stroke={line.color} strokeWidth={2} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
            </g>
          ))}
        </svg>
        {/* This week's points, as HTML so they stay round however wide the chart is, with their values beside them:
            the higher line's labels above it, the lower line's below, so the two never sit on each other. */}
        {series.map((line) => {
          const other = series.find((entry) => entry.key !== line.key)!;
          const above = weeks[last]![line.key] >= weeks[last]![other.key];
          const endAbove = line.end >= other.end;
          return (
            <span key={line.key}>
              <span className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white" style={{ left: `${x(last)}%`, top: `${y(weeks[last]![line.key])}%`, background: line.color }} />
              <span
                className={`absolute pl-1.5 text-xs font-semibold whitespace-nowrap ${above ? "-translate-y-full pb-1" : "pt-1"}`}
                style={{ left: `${x(last)}%`, top: `${y(weeks[last]![line.key])}%` }}
              >
                {line.unit(weeks[last]![line.key])}
              </span>
              <span className={`absolute right-0 text-xs font-semibold tabular-nums text-muted ${endAbove ? "-translate-y-full pb-1" : "pt-1"}`} style={{ top: `${y(line.end)}%` }}>
                {line.end}
              </span>
            </span>
          );
        })}
        {/* Each week can be read by resting the mouse on it. */}
        <div className="absolute inset-y-0 left-0 flex" style={{ width: `${span}%` }}>
          {weeks.map((week) => (
            <div key={week.start} className="h-full flex-1" title={`${week.label} (to ${shortDay(week.end)}): ${week.payingKitchens} paying kitchens, ${week.people} people using the app`} />
          ))}
        </div>
      </div>
      <div className="relative h-4 text-xs text-muted" aria-hidden>
        {weeks.map((week, index) =>
          weeks.length <= 6 || index === 0 || index === last || index % 2 === 0 ? (
            <span key={week.start} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${x(index)}%` }}>
              {week.label}
            </span>
          ) : null,
        )}
        <span className="absolute right-0 whitespace-nowrap">{shortDay(forecastDate)}</span>
      </div>
      {/* Hidden in a box, not on the table itself: a table never shrinks below its contents, and would widen a phone's page. */}
      <div className="sr-only">
      <table>
        <caption>Paying kitchens and people using the app, by week, and where the current pace lands</caption>
        <thead>
          <tr>
            <th scope="col">Week</th>
            <th scope="col">Paying kitchens</th>
            <th scope="col">People using the app</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week.start}>
              <th scope="row">{week.label}</th>
              <td>{week.payingKitchens}</td>
              <td>{week.people}</td>
            </tr>
          ))}
          <tr>
            <th scope="row">Forecast for {shortDay(forecastDate)}</th>
            <td>{forecast.payingKitchens}</td>
            <td>{forecast.people}</td>
          </tr>
        </tbody>
      </table>
      </div>
    </figure>
  );
}

/**
 * Sales won each week, before GST: one bar a week (this week's darker, "so far"), and next
 * week's forecast as a dotted outline. One series, so no legend: the title names it.
 */
export function WonBars({ weeks, nextWeekPaise }: { weeks: readonly GrowthWeekDto[]; nextWeekPaise: number }) {
  const { top, ticks } = scale(Math.max(0, nextWeekPaise, ...weeks.map((week) => week.wonPaise)));
  const height = 150;
  const groups = [
    ...weeks.map((week) => ({ key: week.start, label: week.label, paise: week.wonPaise, kind: week.current ? ("current" as const) : ("past" as const) })),
    { key: "next", label: "Next week", paise: nextWeekPaise, kind: "next" as const },
  ];
  const dense = groups.length > 7;
  return (
    <figure className="flex flex-col gap-1">
      <div className="relative ml-9" style={{ height }} aria-hidden>
        {ticks.map((tick) => (
          <div key={tick} className="absolute inset-x-0 border-t border-border" style={{ bottom: `${(tick / top) * 100}%` }}>
            <span className="absolute -left-9 w-8 -translate-y-1/2 text-right text-xs text-muted tabular-nums">{axisLabel(tick)}</span>
          </div>
        ))}
        <div className="absolute inset-0 flex items-end">
          {groups.map((group) => (
            <div
              key={group.key}
              title={`${group.label}: ${group.kind === "next" ? "about " : ""}${money(group.paise)}${group.kind === "current" ? " so far" : ""}`}
              className="flex h-full min-w-0 flex-1 items-end justify-center px-1"
            >
              <div
                className={`w-full max-w-10 rounded-t-[4px] ${group.kind === "next" ? "border-2 border-b-0 border-dashed border-border-strong bg-transparent" : ""}`}
                style={{
                  height: group.paise > 0 ? `max(2px, ${(group.paise / top) * 100}%)` : 0,
                  ...(group.kind !== "next" && { background: group.kind === "current" ? "#2F6FD6" : "#A9C7F0" }),
                }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="ml-9 flex" aria-hidden>
        {groups.map((group) => (
          <div key={group.key} className="min-w-0 flex-1 px-0.5 text-center text-xs leading-tight text-muted">
            <span className="block font-medium text-foreground">{dense && group.kind === "past" ? group.label.replace("Week ", "W") : group.label}</span>
            {(!dense || group.kind !== "past") && (
              <>
                <span className="block whitespace-nowrap tabular-nums">
                  {group.kind === "next" ? "≈ " : ""}
                  {money(group.paise)}
                </span>
                {group.kind === "current" && <span className="block">so far</span>}
              </>
            )}
          </div>
        ))}
      </div>
      <div className="sr-only">
      <table>
        <caption>Sales won each week, before GST, and next week&apos;s forecast</caption>
        <tbody>
          {groups.map((group) => (
            <tr key={group.key}>
              <th scope="row">{group.label}</th>
              <td>
                {group.kind === "next" ? "about " : ""}
                {money(group.paise)}
                {group.kind === "current" ? " so far" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </figure>
  );
}
