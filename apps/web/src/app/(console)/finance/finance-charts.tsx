"use client";

import type { ReactNode } from "react";

import { axisLabel, COLOR, money, scale } from "./finance-parts";

// The Finance page's charts, drawn with plain HTML, CSS and one small SVG: the console
// has no chart library and needs none for bars and a line. Each chart says what it
// shows in words beside it, the mouse resting on a bar shows its figures, and a hidden
// table gives a screen reader the same numbers.

export interface BarGroup {
  key: string;
  /** Under the bars: "Week 1" and the figures. */
  label: ReactNode;
  /** Shown when the mouse rests on the group, and read in the hidden table. */
  title: string;
  values: number[];
}

/**
 * Bars side by side for each group (collected and expenses each week; cash in and out
 * each day), on one scale that starts at nothing, with light lines at round amounts.
 */
export function GroupedBars({
  groups,
  series,
  height = 180,
  caption,
  barWidth = "w-3",
}: {
  groups: readonly BarGroup[];
  series: readonly { label: string; color: string }[];
  height?: number;
  caption: string;
  barWidth?: string;
}) {
  const { top, ticks } = scale(Math.max(0, ...groups.flatMap((group) => group.values)));
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
            <div key={group.key} title={group.title} className="flex h-full min-w-0 flex-1 items-end justify-center gap-0.5 px-0.5">
              {group.values.map((value, index) => (
                <div
                  key={series[index]?.label ?? index}
                  className={`${barWidth} max-w-[45%] rounded-t-[3px]`}
                  // A small amount still shows as a sliver, so "nothing" and "a little" look different.
                  style={{ height: value > 0 ? `max(2px, ${(value / top) * 100}%)` : 0, background: series[index]?.color }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="ml-9 flex" aria-hidden>
        {groups.map((group) => (
          <div key={group.key} className="min-w-0 flex-1 px-0.5 text-center text-xs leading-tight text-muted">
            {group.label}
          </div>
        ))}
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            {series.map((item) => (
              <th key={item.label} scope="col">
                {item.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.key}>
              <th scope="row">{group.title.split(":")[0]}</th>
              {group.values.map((value, index) => (
                <td key={index}>{money(value)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/**
 * The cash balance as a line, day by day, with the first and last day's balance written
 * at its ends. Days before the opening balance have no point.
 */
export function BalanceLine({ points, caption }: { points: readonly { date: string; paise: number | null; label: string }[]; caption: string }) {
  const known = points.map((point, index) => ({ ...point, index })).filter((point): point is typeof point & { paise: number } => point.paise !== null);
  if (known.length === 0) return <p className="text-sm text-muted">No balance yet: set the opening balance first.</p>;
  const values = known.map((point) => point.paise);
  const low = Math.min(...values);
  const high = Math.max(...values);
  // A flat line sits in the middle rather than on the floor.
  const span = high - low || Math.max(1, Math.abs(high));
  const base = high === low ? low - span / 2 : low;
  const x = (index: number) => (points.length === 1 ? 50 : (index / (points.length - 1)) * 100);
  const y = (paise: number) => 90 - ((paise - base) / span) * 80;
  const path = known.map((point, order) => `${order === 0 ? "M" : "L"}${x(point.index)},${y(point.paise)}`).join(" ");
  const first = known[0]!;
  const last = known[known.length - 1]!;
  return (
    <figure className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-right text-xs text-muted tabular-nums">{money(first.paise)}</span>
      <div className="relative h-16 min-w-0 flex-1">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible" aria-hidden>
          <path d={path} fill="none" stroke={COLOR.in} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
        {/* The last day's dot, as HTML so it stays round however wide the chart is. */}
        <span
          aria-hidden
          className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white"
          style={{ left: `${x(last.index)}%`, top: `${y(last.paise)}%`, background: COLOR.in }}
        />
        {/* Each day can be read by resting the mouse on it. */}
        <div className="absolute inset-0 flex">
          {points.map((point) => (
            <div key={point.date} className="h-full flex-1" title={point.paise === null ? `${point.label}: before the opening balance` : `${point.label}: ${money(point.paise)}`} />
          ))}
        </div>
      </div>
      <span className="w-24 shrink-0 text-sm font-bold tabular-nums">{money(last.paise)}</span>
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {known.map((point) => (
            <tr key={point.date}>
              <th scope="row">{point.label}</th>
              <td>{money(point.paise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** One horizontal bar for a share of a whole: how much of a budget line is used, or a kind of spend against the largest. */
export function Meter({ fraction, color = COLOR.in, track = COLOR.track }: { fraction: number; color?: string; track?: string }) {
  const width = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div aria-hidden className="h-2 w-full overflow-hidden rounded-full" style={{ background: track }}>
      <div className="h-full rounded-full" style={{ width: `${width}%`, background: color, minWidth: fraction > 0 ? 4 : 0 }} />
    </div>
  );
}

/** One bar split into parts of a whole (what the founders' money has paid for; what is owed, by age). Parts of nothing are left out. */
export function StackBar({ parts }: { parts: readonly { label: string; paise: number; color: string }[] }) {
  const total = parts.reduce((sum, part) => sum + Math.max(0, part.paise), 0);
  return (
    <div aria-hidden className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-background">
      {total > 0 &&
        parts
          .filter((part) => part.paise > 0)
          .map((part) => <div key={part.label} title={`${part.label}: ${money(part.paise)}`} style={{ flexGrow: part.paise, flexBasis: 0, background: part.color }} />)}
    </div>
  );
}
