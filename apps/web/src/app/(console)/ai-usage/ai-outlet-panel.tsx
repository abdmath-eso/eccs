"use client";

import type { AiOverviewDto } from "@eccs/shared";
import type { AiUsageFilters } from "@eccs/api-client";
import { useEffect, useState } from "react";

import { Button, ErrorMessage, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { describe } from "@/lib/format";

import { dayMonth, Sheet } from "../finance/finance-parts";
import { helperName, inr, Pill, plural, ShareBar, SpendChart, usd } from "./ai-usage-parts";

// An outlet's own view (19 Oct 2026): opened from its name in "By restaurant", in a panel
// from the right like the Logs page's, so the page stays in view behind it. Its spend per
// day against its own daily cap, its helpers, and the days the cap refused requests, for
// the period on the page. "Show only this outlet" applies the outlet filter to the page.

export function OutletPanel({
  outletId,
  name,
  period,
  onClose,
  onFilter,
}: {
  outletId: string | null;
  name: string;
  period: Pick<AiUsageFilters, "period" | "from" | "to">;
  onClose: () => void;
  onFilter: (outletId: string) => void;
}) {
  const key = outletId ? `${outletId}|${period.period ?? ""}|${period.from ?? ""}|${period.to ?? ""}` : "";
  const [loaded, setLoaded] = useState<{ key: string; data: AiOverviewDto | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const [id, chosen, from, to] = key.split("|");
    api.aiUsage
      .overview({ outlet: [id!], period: (chosen || "month") as AiUsageFilters["period"], ...(from && { from }), ...(to && { to }) })
      .then((data) => !cancelled && setLoaded({ key, data, error: null }))
      .catch((error) => !cancelled && setLoaded({ key, data: null, error: describe(error) }));
    return () => {
      cancelled = true;
    };
  }, [key]);

  const shown = loaded && loaded.key === key ? loaded : null;
  const data = shown?.data ?? null;
  const row = data?.outlets[0] ?? null;
  const helpers = data ? data.helpers.filter((helper) => helper.requests > 0) : [];
  const largest = Math.max(0, ...helpers.map((helper) => helper.costUsd));

  return (
    <Sheet open={outletId !== null} title={name || "Outlet"} onClose={onClose} wide>
      {!shown && <Loading />}
      {shown && !data && <ErrorMessage message={shown.error} />}
      {data && (
        <div className="flex flex-col gap-5 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted">
              {[row?.organizationName, row?.plan ? `${row.plan.name} plan` : "No plan"].filter(Boolean).join(" · ")}
            </p>
            <Button size="sm" variant="secondary" onClick={() => onFilter(outletId!)}>
              Show only this outlet
            </Button>
          </div>

          <dl className="grid grid-cols-3 gap-3">
            <div>
              <dt className="text-muted">AI cost</dt>
              <dd className="text-lg font-bold tabular-nums">{inr(row?.costUsd ?? 0, data.rate)}</dd>
              <dd className="text-xs text-muted">
                {usd(row?.costUsd ?? 0)}
                {data.eccsOwn.costUsd > 0 && ` · and ${inr(data.eccsOwn.costUsd, data.rate)} of ECCS's own work here`}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Requests</dt>
              <dd className="text-lg font-bold tabular-nums">{(row?.requests ?? 0).toLocaleString("en-IN")}</dd>
            </div>
            <div>
              <dt className="text-muted">Of what it pays</dt>
              <dd className="text-lg font-bold tabular-nums">{row?.ofPayPercent == null ? "—" : `${row.ofPayPercent}%`}</dd>
              <dd className="text-xs text-muted">{row?.ofPayPercent == null ? "nothing invoiced in the period" : "of its invoices, before GST"}</dd>
            </div>
          </dl>

          <section className="flex flex-col gap-2">
            <h3 className="font-bold">Spend per day, against its daily cap</h3>
            <p className="text-muted">The dashed line is the outlet&apos;s own cap ({inr(data.daily.limitUsd, data.rate)}). Amber days hit it.</p>
            <SpendChart days={data.daily.days} rate={data.rate} limitUsd={data.daily.limitUsd} caption={`${name}: spend per day`} />
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="font-bold">Its helpers</h3>
            {helpers.length === 0 ? (
              <p className="text-muted">No AI requests in this period.</p>
            ) : (
              // One grid for all the rows, so every bar starts and ends in the same place.
              <ul className="grid grid-cols-[minmax(0,9rem)_minmax(3rem,1fr)_auto] items-center gap-x-3 gap-y-2">
                {helpers.map((helper) => (
                  <li key={helper.feature} className="contents">
                    <span className="truncate">{helperName(helper.feature)}</span>
                    <ShareBar fraction={largest > 0 ? helper.costUsd / largest : 0} />
                    <span className="text-right whitespace-nowrap tabular-nums">
                      {inr(helper.costUsd, data.rate)} <span className="text-muted">· {plural(helper.requests, "request")}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="font-bold">Days it hit its cap</h3>
            {!row || row.capDays.length === 0 ? (
              <p className="flex items-center gap-2">
                <Pill tone="good">Under</Pill>
                <span className="text-muted">Its cap refused nothing in this period.</span>
              </p>
            ) : (
              <p className="flex flex-wrap items-center gap-2">
                <Pill tone="warn">Hit the cap {plural(row.capDays.length, "day")}</Pill>
                <span>{row.capDays.map(dayMonth).join(", ")}</span>
              </p>
            )}
          </section>
        </div>
      )}
    </Sheet>
  );
}
