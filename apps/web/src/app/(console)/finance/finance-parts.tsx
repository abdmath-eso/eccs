"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import { rupees } from "@/lib/format";

// Small pieces the Finance page and its expense book share.

// ───────────────────────── Colours ─────────────────────────

/**
 * The founder's design: blue for money in, orange for money out; a dark, a middle and a
 * light blue for parts of one whole. The blue and the orange were checked to stay
 * apart for colour-blind readers and against the white card (the dataviz palette
 * check); every chart also says in words which is which, so colour is never alone.
 */
export const COLOR = {
  in: "#2F6FD6",
  out: "#E8662F",
  dark: "#123A74",
  light: "#BFD4F2",
  track: "#E4ECF8",
  over: "#C62828",
} as const;

// ───────────────────────── Words and numbers ─────────────────────────

/** Rupees with a real minus sign for a negative amount: "−₹1,52,300". */
export const money = (paise: number) => (paise < 0 ? `−${rupees(-paise)}` : rupees(paise));

/** Rupees with a sign either way: "+₹12,400", "−₹9,940". */
export const signed = (paise: number) => (paise < 0 ? `−${rupees(-paise)}` : `+${rupees(paise)}`);

const day = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", ...options }).format(new Date(`${date.slice(0, 10)}T00:00:00Z`));

/** "15 Oct". */
export const dayMonth = (date: string) => day(date, { day: "numeric", month: "short" });
/** "Thursday 15 October". */
export const longWeekday = (date: string) => day(date, { weekday: "long", day: "numeric", month: "long" }).replace(",", "");
/** "Thursday 15". */
export const weekdayDay = (date: string) => day(date, { weekday: "long", day: "numeric" }).replace(",", "");
/** "Thu". */
export const weekdayShort = (date: string) => day(date, { weekday: "short" });

/** An axis label: "80K", "1.5L" (lakh), "0". */
export function axisLabel(paise: number) {
  const value = paise / 100;
  if (value >= 100_000) return `${Number((value / 100_000).toFixed(1))}L`;
  if (value >= 1000) return `${Number((value / 1000).toFixed(1))}K`;
  return String(Math.round(value));
}

/** A round top for a chart's scale, and the steps up to it: 0, 20K, 40K, 60K, 80K. */
export function scale(max: number, steps = 4): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 100_00 * steps, ticks: Array.from({ length: steps + 1 }, (_, index) => index * 100_00) };
  const rough = max / steps;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough) ?? 10 * power;
  return { top: step * steps, ticks: Array.from({ length: steps + 1 }, (_, index) => index * step) };
}

/** "1 visit", "2 visits". */
export const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

/** Rupees as typed ("2124", "2,124.50", "₹2124") into whole paise; null when it is not an amount. */
export function toPaise(typed: string): number | null {
  const cleaned = typed.replace(/[₹,\s]/g, "");
  if (cleaned === "") return null;
  return /^-?\d+(\.\d{1,2})?$/.test(cleaned) ? Math.round(Number(cleaned) * 100) : null;
}

/** Paise as a form shows them: "2124.50", or "2124" for whole rupees. */
export const paiseField = (paise: number) => (paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2));

// ───────────────────────── Pieces ─────────────────────────

/**
 * A joined row of buttons, one of them on, as in the founder's design ("Period",
 * "Compare with"). Each says whether it is on (`aria-pressed`) and the one on is
 * filled dark, so the choice does not rest on colour alone.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  showLabel = true,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  showLabel?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {showLabel && <span className="text-sm text-muted">{label}</span>}
      <div role="group" aria-label={label} className="inline-flex flex-wrap overflow-hidden rounded-lg border border-border-strong bg-surface">
        {options.map((option, index) => {
          const on = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(option.value)}
              className={`min-h-9 cursor-pointer px-3 py-1.5 text-sm font-semibold ${index > 0 ? "border-l border-border-strong" : ""} ${
                on ? "bg-foreground text-white" : "text-foreground hover:bg-background"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A section of the page: a white card with its title, one short line under it, and an action on the right. */
export function Panel({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={`flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-surface p-5 ${className}`}>
      {/* The action drops under the title when there is no room beside it (a phone). */}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-[14rem] flex-1">
          <h2 id={headingId} className="font-bold">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** The key under a chart: a coloured square and its name for each series. */
export function Legend({ items }: { items: readonly { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-3 shrink-0 rounded-sm" style={{ background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * A panel that slides in from the right edge for a form (add an expense, the budget,
 * the founders' money). A real dialog: the keyboard stays inside, Escape closes it, and
 * the keyboard goes back where it was afterwards. The drawer pattern of established
 * back-office apps (Zoho Books, Stripe): the page stays in view behind it.
 */
export function Sheet({ open, title, onClose, children, wide = false }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      // A click on the dimmed page beside the panel lands on the dialog itself.
      onClick={(event) => event.target === event.currentTarget && ref.current?.close()}
      className={`side-sheet my-0 mr-0 ml-auto h-dvh max-h-none ${wide ? "w-[44rem]" : "w-[32rem]"} max-w-full border-l border-border bg-surface p-0 text-foreground shadow-xl`}
    >
      {open && (
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3">
            <h2 id={titleId} className="text-lg font-bold">
              {title}
            </h2>
            <button
              type="button"
              aria-label="Close"
              onClick={() => ref.current?.close()}
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-xl text-foreground hover:bg-background"
            >
              <span aria-hidden>✕</span>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

/** "Sample data": shown while the books hold sample rows, which can all be removed before real use. */
export function SampleBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-xs font-semibold text-muted">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-muted" />
      Sample data
    </span>
  );
}

/** Saves a file the server made (a CSV) under its own name. */
export function saveFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
