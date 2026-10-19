"use client";

import { AI_HELPERS, type AiDayDto, type AiFeature } from "@eccs/shared";
import type { ReactNode } from "react";

import { COLOR, dayMonth } from "../finance/finance-parts";

// Pieces of the AI usage page (19 Oct 2026): money in rupees and dollars, the status pills,
// and the spend chart. The chart is plain HTML like Finance's: one blue for spend, amber
// for a day a limit refused requests (the pair checked for colour-blind readers with the
// dataviz palette validator), the limit as a dashed line, each bar's figures on hover and
// in a hidden table, and the meaning said in words beside it so colour is never alone.

/** Amber for a day that touched a limit: apart from the spend's blue for every kind of colour vision. */
export const LIMIT_COLOR = "#B45309";

// ───────────────────────── Money ─────────────────────────

/**
 * US dollars as rupees at the rate set: whole rupees from ₹10 ("₹4,120", "₹21"), paise
 * below that ("₹0.24"), and "<₹0.01" for the smallest requests.
 */
export function inr(usd: number, rate: number): string {
  const value = usd * rate;
  if (value === 0) return "₹0";
  if (value < 0.01) return "<₹0.01";
  if (value < 10) return `₹${value.toFixed(2)}`;
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

/** US dollars with enough places for a request that cost a fraction of a cent: "US$49.05", "US$0.0042". */
export function usd(amount: number): string {
  if (amount === 0) return "US$0";
  if (amount < 0.01) return `US$${amount.toFixed(4)}`;
  return `US$${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "17,245". */
export const whole = (n: number) => n.toLocaleString("en-IN");

/** "1 request", "2 requests". */
export const plural = (n: number, one: string, many = `${one}s`) => `${whole(n)} ${n === 1 ? one : many}`;

/** "4.2 s", "850 ms". */
export const seconds = (ms: number | null) => (ms === null ? "—" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

/** A helper's name; anything this version does not know as it is. */
export const helperName = (feature: string) => AI_HELPERS[feature as AiFeature]?.name ?? feature;

// ───────────────────────── Pills ─────────────────────────

export type Tone = "good" | "warn" | "bad" | "plain";

const TONE: Record<Tone, string> = {
  good: "bg-emerald-50 text-emerald-800 border-emerald-200",
  warn: "bg-amber-50 text-amber-900 border-amber-300",
  bad: "bg-danger/10 text-danger border-danger/30",
  plain: "bg-background text-muted border-border",
};

const DOT: Record<Tone, string> = { good: "bg-emerald-600", warn: "bg-amber-600", bad: "bg-danger", plain: "bg-muted" };

/** A small rounded label with a dot, as the design's "Fine", "Under", "Hit the cap 3 days". The words carry the meaning. */
export function Pill({ tone, wrap = false, children }: { tone: Tone; wrap?: boolean; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold ${wrap ? "" : "whitespace-nowrap"} ${TONE[tone]}`}>
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[tone]}`} />
      {children}
    </span>
  );
}

// ───────────────────────── The spend chart ─────────────────────────

/** A round top for the rupee scale and its steps: 0, ₹50, ₹100, ₹150, ₹200. */
function rupeeScale(max: number): { top: number; ticks: number[] } {
  const steps = 4;
  if (max <= 0) return { top: 4, ticks: [0, 1, 2, 3, 4] };
  const rough = max / steps;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough) ?? 10 * power;
  return { top: step * steps, ticks: Array.from({ length: steps + 1 }, (_, index) => index * step) };
}

const tickLabel = (rupees: number) => (rupees >= 1000 ? `₹${Number((rupees / 1000).toFixed(1))}K` : rupees >= 10 || rupees === 0 ? `₹${Math.round(rupees)}` : `₹${Number(rupees.toFixed(2))}`);

/**
 * Spend per day in rupees: one bar a day on one scale from nothing, the limit as a dashed
 * line (when it applies to what is shown), and days a limit refused requests in amber.
 */
export function SpendChart({ days, rate, limitUsd, caption }: { days: readonly AiDayDto[]; rate: number; limitUsd: number | null; caption: string }) {
  const values = days.map((day) => day.usd * rate);
  const limit = limitUsd === null ? null : limitUsd * rate;
  const { top, ticks } = rupeeScale(Math.max(0, ...values, limit ?? 0));
  const every = days.length > 31 ? 7 : days.length > 16 ? 2 : 1;
  return (
    <figure className="relative flex flex-col gap-1">
      <div className="relative ml-11" style={{ height: 190 }} aria-hidden>
        {ticks.map((tick) => (
          <div key={tick} className="absolute inset-x-0 border-t border-border" style={{ bottom: `${(tick / top) * 100}%` }}>
            <span className="absolute -left-11 w-10 -translate-y-1/2 text-right text-xs text-muted tabular-nums">{tickLabel(tick)}</span>
          </div>
        ))}
        <div className="absolute inset-0 flex items-end">
          {days.map((day, index) => (
            <div
              key={day.date}
              title={`${dayMonth(day.date)}: ${inr(day.usd, rate)} (${usd(day.usd)}), ${plural(day.requests, "request")}${day.limitHit ? ", a limit refused some" : ""}`}
              className="flex h-full min-w-0 flex-1 items-end justify-center px-[3px]"
            >
              <div
                className="w-full max-w-7 rounded-t-[4px]"
                // A small amount still shows as a sliver, so "nothing" and "a little" look different.
                style={{ height: values[index]! > 0 ? `max(2px, ${(values[index]! / top) * 100}%)` : 0, background: day.limitHit ? LIMIT_COLOR : COLOR.in }}
              />
            </div>
          ))}
        </div>
        {limit !== null && limit > 0 && <div className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed" style={{ bottom: `${(limit / top) * 100}%`, borderColor: LIMIT_COLOR }} />}
      </div>
      <div className="ml-11 flex" aria-hidden>
        {days.map((day, index) => (
          <div key={day.date} className="min-w-0 flex-1 text-center text-xs text-muted tabular-nums">
            {index % every === 0 || index === days.length - 1 ? Number(day.date.slice(8)) : ""}
          </div>
        ))}
      </div>
      {/* Hidden in a div: a table keeps its full width even when told to be 1px, and would widen a phone's page. */}
      <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Spend</th>
            <th scope="col">Requests</th>
            <th scope="col">A limit refused requests</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}>
              <th scope="row">{dayMonth(day.date)}</th>
              <td>{inr(day.usd, rate)}</td>
              <td>{day.requests}</td>
              <td>{day.limitHit ? "yes" : "no"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </figure>
  );
}

/** A thin bar for a share of a whole (a helper's part of the spend, the credit left). */
export function ShareBar({ fraction, color = COLOR.in, className = "" }: { fraction: number; color?: string; className?: string }) {
  const width = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div aria-hidden className={`h-2 w-full overflow-hidden rounded-full ${className}`} style={{ background: COLOR.track }}>
      <div className="h-full rounded-full" style={{ width: `${width}%`, background: color, minWidth: fraction > 0 ? 4 : 0 }} />
    </div>
  );
}
