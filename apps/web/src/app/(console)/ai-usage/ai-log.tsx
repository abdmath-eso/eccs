"use client";

import { AI_LIMIT_LABELS, AI_OUTCOME_LABELS, AI_RESULT_LABELS, AI_SOURCE_LABELS, AI_USAGE_RULES, aiModelName, aiResultOf, type AiRequestEntryDto, type AiResult } from "@eccs/shared";

import { Button, EmptyState, ErrorMessage } from "@/components/ui";

import { helperName, inr, Pill, plural, seconds, usd, whole, type Tone } from "./ai-usage-parts";

// The AI usage page's log (19 Oct 2026): every request under the filters, newest first, 50
// at a time, as the request logs of Anthropic's Console, Helicone and Langfuse list them:
// when, which helper and model, where and who, tokens, cost, time taken, how it ended and
// what the person did with the answer. The log never holds any words of a question or an
// answer, so there are none to show.

const RESULT_TONE: Record<AiResult, Tone> = { answered: "good", limit: "warn", off: "plain", failed: "bad", invalid: "bad" };

/** "19 Oct, 2:42 pm", India time. */
const time = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })
    .format(new Date(iso))
    .replace(/\b(am|pm)\b/i, (part) => part.toLowerCase());

function Result({ entry }: { entry: AiRequestEntryDto }) {
  const result = aiResultOf(entry.status);
  const why = entry.errorCode ? (AI_LIMIT_LABELS[entry.errorCode] ?? entry.errorCode) : null;
  return (
    <span className="flex flex-col items-start gap-0.5">
      <Pill tone={RESULT_TONE[result]}>{AI_RESULT_LABELS[result]}</Pill>
      {why && <span className="text-xs text-muted">{why}</span>}
    </span>
  );
}

export function RequestLog({
  entries,
  total,
  rate,
  loading,
  hasMore,
  moreBusy,
  moreError,
  filtered,
  onMore,
  onClear,
}: {
  entries: AiRequestEntryDto[];
  total: number;
  rate: number;
  loading: boolean;
  hasMore: boolean;
  moreBusy: boolean;
  moreError: string | null;
  filtered: boolean;
  onMore: () => void;
  onClear: () => void;
}) {
  if (!loading && entries.length === 0) {
    return (
      <EmptyState
        title={filtered ? "No requests match" : "No AI requests in this period"}
        action={
          filtered ? (
            <Button variant="secondary" onClick={onClear}>
              Clear the filters
            </Button>
          ) : undefined
        }
      >
        {filtered ? "Try a longer period or fewer filters." : "Try a longer period."}
      </EmptyState>
    );
  }
  // An outlet's name says its restaurant already ("Spice Route, Gachibowli"); without one, the restaurant, or ECCS's own work.
  const place = (entry: AiRequestEntryDto) => entry.outletName ?? entry.organizationName ?? (entry.outletId ? "A removed outlet" : "ECCS");
  const who = (entry: AiRequestEntryDto) => (entry.person ? `${entry.person.name}${entry.person.role ? ` · ${entry.person.role}` : ""}` : "The server");
  const tokens = (entry: AiRequestEntryDto) => {
    const cached = entry.cacheReadTokens + entry.cacheWriteTokens;
    return `${whole(entry.inputTokens)} in${cached > 0 ? ` (${whole(cached)} cached)` : ""} · ${whole(entry.outputTokens)} out`;
  };

  return (
    <div className={`flex flex-col gap-3 ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
      <p className="text-sm text-muted" role="status">
        {plural(total, "request")}, newest first{total > entries.length ? `; ${whole(entries.length)} shown` : ""}.
      </p>

      {/* A computer: one row per request. */}
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-surface md:block">
        <table className="w-full min-w-[52rem] text-left text-sm">
          <caption className="sr-only">AI requests, newest first</caption>
          <thead className="border-b border-border text-muted">
            <tr>
              <th scope="col" className="py-2 pr-2 pl-3 font-medium">Time</th>
              <th scope="col" className="px-2 py-2 font-medium whitespace-nowrap">Helper</th>
              <th scope="col" className="px-2 py-2 font-medium whitespace-nowrap">Outlet</th>
              <th scope="col" className="px-2 py-2 font-medium whitespace-nowrap">Who</th>
              <th scope="col" className="px-2 py-2 font-medium whitespace-nowrap">Tokens</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Cost</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Took</th>
              <th scope="col" className="py-2 pr-3 pl-2 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-b border-border align-top last:border-0">
                <td className="py-2 pr-2 pl-3 whitespace-nowrap text-muted">{time(entry.at)}</td>
                <td className="px-2 py-2 whitespace-nowrap">
                  <span className="block font-semibold">{helperName(entry.feature)}</span>
                  <span className="block text-xs text-muted">
                    {aiModelName(entry.model)}
                    {entry.source && ` · ${AI_SOURCE_LABELS[entry.source]}`}
                  </span>
                </td>
                <td className="max-w-[11rem] px-2 py-2">
                  <span className="block truncate">{place(entry)}</span>
                </td>
                <td className="max-w-[10rem] px-2 py-2">
                  <span className="block truncate">{entry.person?.name ?? "The server"}</span>
                  {entry.person?.role && <span className="block text-xs text-muted">{entry.person.role}</span>}
                </td>
                <td className="px-2 py-2 text-xs whitespace-nowrap text-muted tabular-nums">{tokens(entry)}</td>
                <td className="px-2 py-2 text-right whitespace-nowrap tabular-nums" title={usd(entry.costUsd)}>
                  {inr(entry.costUsd, rate)}
                </td>
                <td className="px-2 py-2 text-right whitespace-nowrap tabular-nums">{entry.durationMs > 0 ? seconds(entry.durationMs) : "—"}</td>
                <td className="py-2 pr-3 pl-2">
                  <Result entry={entry} />
                  {entry.outcome && <span className="mt-0.5 block text-xs text-muted">{AI_OUTCOME_LABELS[entry.outcome] ?? entry.outcome}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* A phone: one card per request. */}
      <ul className="flex flex-col gap-2 md:hidden">
        {entries.map((entry) => (
          <li key={entry.id} className="rounded-xl border border-border bg-surface p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="block font-semibold">{helperName(entry.feature)}</span>
                <span className="block text-xs text-muted">
                  {time(entry.at)} · {aiModelName(entry.model)}
                </span>
              </span>
              <span className="font-semibold whitespace-nowrap tabular-nums">{inr(entry.costUsd, rate)}</span>
            </div>
            <p className="mt-1 truncate">{place(entry)}</p>
            <p className="truncate text-muted">{who(entry)}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
              <Result entry={entry} />
              {entry.outcome && <span>{AI_OUTCOME_LABELS[entry.outcome] ?? entry.outcome}</span>}
              <span className="tabular-nums">{tokens(entry)}</span>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-col items-center gap-2">
        {hasMore ? (
          <Button variant="secondary" onClick={onMore} loading={moreBusy}>
            Load {AI_USAGE_RULES.pageSize} more
          </Button>
        ) : (
          entries.length > 0 && <p className="text-sm text-muted">That is every request in this period.</p>
        )}
        <ErrorMessage message={moreError} />
      </div>
    </div>
  );
}
