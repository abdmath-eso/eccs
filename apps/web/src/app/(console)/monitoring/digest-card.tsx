"use client";

import type { MonitoringDigestDto } from "@eccs/shared";
import { useEffect, useState, type MouseEvent } from "react";

import { api } from "@/lib/api";

/** "9:14 am", in India's time. */
const timeOf = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

type Shown = { status: "loading" } | { status: "hidden" } | { status: "shown"; digest: MonitoringDigestDto };

const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const startsWithWords = (text: string[], start: string[]) => start.length > 0 && start.every((word, index) => text[index] === word);

/**
 * True when the outlet's name already says which restaurant it is, so "(restaurant)"
 * after it would only repeat it: "Deccan Biryani House, Kukatpally" begins with
 * "Deccan Biryani House", and "Spice Route, Gachibowli" begins with the first words of
 * "Spice Route Kitchens" (its name before the comma).
 */
function namesRestaurant(outletName: string, restaurantName: string): boolean {
  const restaurant = words(restaurantName);
  return startsWithWords(words(outletName), restaurant) || startsWithWords(restaurant, words(outletName.split(",")[0] ?? ""));
}

/**
 * Today's digest at the top of the Monitoring board (14 Oct 2026), for the Super Admin
 * and the Operations Manager: one line on the day, then up to six short points, each
 * about one outlet that needs attention, in the board's own order. Written by AI from the
 * board's own facts on the first opening of the day and kept for the day.
 *
 * The pattern is the AI summary card at the top of an operations dashboard, refreshed
 * daily, labelled as AI-written, short first with the detail one click away (devtodev's
 * "AI-powered dashboard insights", SurveySensum's "Dashboard AI summary", Hurree's
 * dashboard summaries). Following Microsoft's HAX guidelines it says it was written by
 * AI (G1, G2), links each point to the outlet it is about so the facts are one click
 * away (G11), and asks "Helpful?" (G15).
 *
 * It is loaded on its own, so the board never waits for it. When AI is off, over its
 * limit or fails, nothing is shown and the board is as it always was.
 */
export function DigestCard({
  outletLink,
}: {
  /** Where an outlet's name leads: its row on the board, opened. */
  outletLink: (outletId: string) => { href: string; onClick: (event: MouseEvent<HTMLAnchorElement>) => void };
}) {
  const [shown, setShown] = useState<Shown>({ status: "loading" });
  const [updating, setUpdating] = useState(false);
  const [updateFailed, setUpdateFailed] = useState(false);
  const [vote, setVote] = useState<{ id: string; helpful: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.monitoring
      .digest()
      .then((digest) => !cancelled && setShown({ status: "shown", digest }))
      .catch(() => !cancelled && setShown({ status: "hidden" }));
    return () => {
      cancelled = true;
    };
  }, []);

  if (shown.status === "hidden") return null;
  if (shown.status === "loading") {
    return (
      <p role="status" className="text-sm text-muted">
        Writing today&apos;s digest…
      </p>
    );
  }

  const digest = shown.digest;
  const helpful = vote?.id === digest.aiRequestId ? vote.helpful : digest.helpful;

  async function update() {
    setUpdating(true);
    setUpdateFailed(false);
    try {
      setShown({ status: "shown", digest: await api.monitoring.updateDigest() });
    } catch {
      // The day's digest stays as it was.
      setUpdateFailed(true);
    } finally {
      setUpdating(false);
    }
  }

  function rate(value: boolean) {
    setVote({ id: digest.aiRequestId, helpful: value });
    void api.ai.outcome(digest.aiRequestId, value ? "HELPFUL" : "NOT_HELPFUL").catch(() => undefined);
  }

  const thumb = (value: boolean) => (
    <button
      type="button"
      aria-pressed={helpful === value}
      onClick={() => rate(value)}
      className={`cursor-pointer rounded-md border px-2 py-0.5 font-semibold ${
        helpful === value ? "border-primary text-primary" : "border-border-strong hover:border-primary"
      }`}
    >
      {value ? "Yes" : "No"}
    </button>
  );

  return (
    <section aria-labelledby="digest-title" className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="digest-title" className="font-bold">
          <span aria-hidden>✦ </span>Today&apos;s digest
        </h2>
        <p className="text-xs text-muted">
          Written by AI from today&apos;s board · Made at {timeOf(digest.madeAt)}
          {digest.canUpdate && (
            <>
              {" · "}
              <button type="button" disabled={updating} onClick={() => void update()} className="cursor-pointer font-semibold text-primary hover:underline disabled:opacity-50">
                {updating ? "Updating…" : "Update"}
              </button>
            </>
          )}
          {updateFailed && " · Could not update just now"}
        </p>
      </div>
      <p>{digest.overview}</p>
      {digest.points.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {digest.points.map((point) => (
            <li key={point.outletId}>
              <a {...outletLink(point.outletId)} className="font-semibold text-primary hover:underline">
                {point.outletName}
              </a>
              {!namesRestaurant(point.outletName, point.organizationName) && <span className="text-muted"> ({point.organizationName})</span>}:{" "}
              {point.text}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted" role="group" aria-label="Was the digest helpful?">
        {helpful === null ? "Helpful?" : "Thanks for telling us."}
        {thumb(true)}
        {thumb(false)}
      </div>
    </section>
  );
}
