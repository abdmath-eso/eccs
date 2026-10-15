"use client";

import { useEffect, useState } from "react";

import { fullTime, RESULT_LABEL, shortTime, SOURCE_BADGE, SOURCE_SHORT } from "./log-view";

// Small pieces the Logs page uses in the table, the phone list and the side panel.

const SOURCE_STYLE: Record<string, string> = {
  RESTAURANT_APP: "border-orange-200 bg-orange-50 text-orange-900",
  SUPERVISOR_APP: "border-sky-200 bg-sky-50 text-sky-900",
  CONSOLE: "border-primary/30 bg-primary/10 text-primary",
  SYSTEM: "border-border bg-background text-muted",
  PUBLIC: "border-violet-200 bg-violet-50 text-violet-900",
};

/**
 * Where an event came from, as a small badge. The words carry the meaning; the tint
 * only helps the eye. `short` is for the table's narrow Source column.
 */
export function SourceBadge({ source, short = false }: { source: string; short?: boolean }) {
  return (
    <span
      title={short ? SOURCE_SHORT[source] : undefined}
      className={`inline-block rounded-md border px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap ${SOURCE_STYLE[source] ?? SOURCE_STYLE.SYSTEM}`}
    >
      {(short ? SOURCE_BADGE[source] : SOURCE_SHORT[source]) ?? source}
    </span>
  );
}

// Success is the quiet one: most rows are successes, and the failures are what the eye should find.
const RESULT_STYLE: Record<string, { mark: string; style: string }> = {
  SUCCESS: { mark: "✓", style: "border-transparent text-muted" },
  REFUSED: { mark: "⊘", style: "border-danger bg-danger px-2 text-white" },
  REJECTED: { mark: "!", style: "border-danger px-2 text-danger" },
  FAILED: { mark: "✕", style: "border-danger bg-danger px-2 text-white" },
};

/** How it ended. A failure stands out with a filled or red badge and its own mark, never by colour alone. */
export function ResultBadge({ result }: { result: string }) {
  const look = RESULT_STYLE[result] ?? RESULT_STYLE.SUCCESS!;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border py-0.5 text-xs font-semibold whitespace-nowrap ${look.style}`}>
      <span aria-hidden>{look.mark}</span>
      {RESULT_LABEL[result] ?? result}
    </span>
  );
}

export const isFailure = (result: string) => result !== "SUCCESS";

/** "15 Oct, 5:42 pm", with the seconds when the mouse rests on it. */
export function Time({ at }: { at: string }) {
  return (
    <time dateTime={at} title={fullTime(at)} className="whitespace-nowrap">
      {shortTime(at)}
    </time>
  );
}

/** A small "AI" mark beside an AI event's description. */
export function AiMark() {
  return (
    <span className="ml-1.5 inline-block rounded border border-violet-300 px-1 text-[0.65rem] leading-4 font-bold text-violet-800 align-middle">AI</span>
  );
}

/** Copies a value and says "Copied" for two seconds. */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard
          ?.writeText(value)
          .then(() => setCopied(true))
          .catch(() => undefined);
      }}
      className="cursor-pointer rounded-md border border-border-strong px-2 py-0.5 text-xs font-semibold hover:bg-background"
    >
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </button>
  );
}
