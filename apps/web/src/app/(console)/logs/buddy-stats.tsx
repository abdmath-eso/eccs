"use client";

import type { BuddyStatsDto } from "@eccs/shared";
import { useState } from "react";
import { api } from "@/lib/api";
import { usd } from "./log-view";

/**
 * ECCS Buddy in the restaurant app, per day for the last two weeks and per restaurant (16 Oct 2026):
 * chats, messages, changes made through a card, answers marked not helpful, messages refused (out of
 * scope, abuse, or an answer the check replaced), people paused, and the cost. Only counts the
 * founder can act on, never what anyone wrote: the chats stay with the restaurant. Shown on the Logs
 * page's AI tab, folded until opened, and loaded only then.
 */
export function BuddyStats() {
  const [stats, setStats] = useState<BuddyStatsDto | null>(null);
  const [failed, setFailed] = useState(false);

  function load() {
    if (stats) return;
    api.buddy
      .stats()
      .then(setStats)
      .catch(() => setFailed(true));
  }

  const days = stats?.days ?? [];
  const total = (key: "chats" | "messages" | "changes" | "notHelpful" | "blocked" | "paused") => days.reduce((sum, day) => sum + day[key], 0);
  const cell = "py-1 pr-3";
  return (
    <details className="rounded-lg border border-border bg-surface px-4 py-2 text-sm" onToggle={(event) => (event.currentTarget.open ? load() : undefined)}>
      <summary className="cursor-pointer py-1 font-semibold text-primary">ECCS Buddy: the last 14 days</summary>
      {failed && <p className="mt-2 text-danger">Could not load the counts. Close and open this again.</p>}
      {!stats && !failed && <p className="mt-2 text-muted">Loading…</p>}
      {stats && (
        <div className="mt-2 flex flex-col gap-3">
          <p className="text-muted">
            {total("chats")} chats, {total("messages")} messages, {total("changes")} changes made, {total("notHelpful")} answers marked not helpful,{" "}
            {total("blocked")} messages refused, {total("paused")} times a person was paused for the day. The chats themselves are the restaurant&apos;s and
            are not shown here.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left">
              <thead className="text-muted">
                <tr>
                  {["Day", "Chats", "Messages", "Changes made", "Not helpful", "Refused", "Paused", "Cost"].map((heading) => (
                    <th key={heading} className={`${cell} font-semibold`}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.map((day) => (
                  <tr key={day.date} className="border-t border-border">
                    <td className={cell}>{day.date}</td>
                    <td className={cell}>{day.chats}</td>
                    <td className={cell}>{day.messages}</td>
                    <td className={cell}>{day.changes}</td>
                    <td className={cell}>{day.notHelpful}</td>
                    <td className={cell}>{day.blocked}</td>
                    <td className={cell}>{day.paused}</td>
                    <td className="py-1">{usd(day.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {stats.restaurants.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left">
                <thead className="text-muted">
                  <tr>
                    {["Restaurant", "Messages", "Refused", "Paused"].map((heading) => (
                      <th key={heading} className={`${cell} font-semibold`}>
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stats.restaurants.map((row) => (
                    <tr key={row.organizationId} className="border-t border-border">
                      <td className={cell}>{row.name}</td>
                      <td className={cell}>{row.messages}</td>
                      <td className={cell}>{row.blocked}</td>
                      <td className={cell}>{row.paused}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </details>
  );
}
