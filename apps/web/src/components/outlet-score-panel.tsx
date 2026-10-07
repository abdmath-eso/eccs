"use client";

import type { HygieneScoreDto, ScoreBand, ScoreComponentKey, ScoreReason, ScoreReasonCode } from "@eccs/shared";
import { useEffect, useState } from "react";

import { ErrorMessage, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { describe } from "@/lib/format";

const BAND: Record<ScoreBand, { label: string; style: string }> = {
  EXCELLENT: { label: "Excellent", style: "border-primary text-primary" },
  GOOD: { label: "Good", style: "border-primary text-primary" },
  FAIR: { label: "Fair", style: "border-amber-600 text-amber-700" },
  NEEDS_ATTENTION: { label: "Needs attention", style: "border-danger text-danger" },
};

const PART: Record<ScoreComponentKey, string> = {
  inspection: "ECCS inspection (latest approved, last 180 days)",
  licences: "Licences",
  checklists: "Checklists (the day's, on time in full, late half)",
};

const REASON: Record<ScoreReasonCode, (reason: ScoreReason) => string> = {
  CHECKLISTS_MISSED: (r) => `${r.count} of ${r.total} not handed in today`,
  CHECKLISTS_LATE: (r) => `${r.count} of ${r.total} handed in late today`,
  CHECKLISTS_MISSED_YESTERDAY: (r) => `${r.count} of ${r.total} not handed in yesterday`,
  CHECKLISTS_LATE_YESTERDAY: (r) => `${r.count} of ${r.total} handed in late yesterday`,
  LICENCES_EXPIRED: (r) => `${r.count} expired`,
  FSSAI_MISSING: () => "No FSSAI licence on record",
  LICENCE_COPIES_MISSING: (r) => `${r.count} with no copy on file`,
  LICENCES_EXPIRING: (r) => `${r.count} expiring soon (no points lost yet)`,
  INSPECTION_NON_COMPLIANT: (r) => `${r.count} checks not compliant at the last inspection`,
};

/**
 * An outlet's hygiene score with what it is made of, to read only. The rule
 * is in packages/shared/src/scores.ts; this shows exactly what the restaurant's
 * Owner and Manager see in the app.
 */
export function OutletScorePanel({ outletId, outletName }: { outletId: string; outletName: string }) {
  // Kept with the outlet it belongs to, so choosing another outlet never shows the last one's score.
  const [loaded, setLoaded] = useState<HygieneScoreDto | null>(null);
  const [failure, setFailure] = useState<{ outletId: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.scores
      .get(outletId)
      .then((fresh) => !cancelled && setLoaded(fresh))
      .catch((e) => !cancelled && setFailure({ outletId, message: describe(e) }));
    return () => {
      cancelled = true;
    };
  }, [outletId]);

  const score = loaded?.outletId === outletId ? loaded : null;
  const error = !score && failure?.outletId === outletId ? failure.message : null;
  const detail = score?.detail ?? null;

  return (
    <section className="flex flex-col gap-3 border-b border-border pb-5">
      <h2 className="text-lg font-bold">Hygiene score at {outletName}</h2>
      {!score && !error && <Loading />}
      <ErrorMessage message={error} />

      {score && score.score === null && (
        <p className="text-muted">No score yet: this outlet has not been inspected and no checklist has fallen due.</p>
      )}
      {score && score.score !== null && score.band && (
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-3xl font-bold">{score.score}</span>
          <span className="text-muted">out of 100</span>
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${BAND[score.band].style}`}>
            {BAND[score.band].label}
          </span>
          {score.change !== null && (
            <span className="text-sm text-muted">
              {score.change === 0
                ? "No change since last week"
                : `${score.change > 0 ? "Up" : "Down"} ${Math.abs(score.change)} since last week`}
            </span>
          )}
        </p>
      )}
      {score && score.provisional && (
        <p className="text-sm text-muted">
          Provisional: not yet inspected by ECCS (or the last inspection is over 180 days old), so the score comes from licences and
          checklists alone.
        </p>
      )}

      {detail && (
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-primary">
            What it is made of{detail.possible > 0 ? ` (${detail.earned} of ${detail.possible} points possible)` : ""}
          </summary>
          <div className="-mx-4 mt-2 overflow-x-auto px-4">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr className="border-b border-border">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Part
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Points
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    What cost points
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.components.map((part) => (
                  <tr key={part.key} className="border-b border-border align-top last:border-0">
                    <th scope="row" className="py-2 pr-4 font-normal">
                      {PART[part.key]}
                    </th>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {part.measured ? `${part.earned} of ${part.max}` : <span className="text-muted">Not measured yet</span>}
                    </td>
                    <td className="py-2">
                      {part.reasons.length === 0 && <span className="text-muted">{part.measured ? "Nothing" : "Left out of the score"}</span>}
                      {part.reasons.map((reason) => (
                        <div key={reason.code}>
                          {REASON[reason.code](reason)}
                          {reason.lost > 0 && <span className="text-muted"> (−{reason.lost})</span>}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-sm text-muted">
            Score = points earned ÷ points possible × 100. The inspection counts for 60, licences for 10 and the checklists of the day for 30.
            A part with nothing to measure yet is left out.
            {score?.checklistsDay === "YESTERDAY" ? " Yesterday's checklists are counted until the first one falls due today." : ""}
          </p>
        </details>
      )}
    </section>
  );
}
