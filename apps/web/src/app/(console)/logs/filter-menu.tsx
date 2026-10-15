"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

// The Logs page's filter menus: a button in the filter bar that opens a small panel
// under it. Each list menu has a search box (when the list is long) and a tick box
// per choice with how many events have it, the usual faceted filter of log and
// audit pages (Stripe's Dashboard logs, GitHub's audit log, Datadog's facets).

export interface MenuOption {
  value: string;
  label: string;
  count: number;
  /** A second, lighter line: the restaurant of an outlet, the role of a person. */
  detail?: string | null;
  /** A heading the option is listed under (actions are listed under their area). */
  group?: string | null;
}

interface Place {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

/** Under the button, kept inside the window with a 16px margin. */
function placeUnder(button: HTMLElement, width: number): Place {
  const rect = button.getBoundingClientRect();
  const gutter = 16;
  const fitted = Math.min(width, window.innerWidth - gutter * 2);
  const left = Math.min(Math.max(gutter, rect.left), window.innerWidth - gutter - fitted);
  const top = rect.bottom + 6;
  return { left, top, width: fitted, maxHeight: Math.max(220, window.innerHeight - top - gutter) };
}

/**
 * A button that opens a panel under it. The panel closes on Escape (the keyboard
 * goes back to the button), on a click elsewhere, and when the page scrolls or the
 * window changes size, so it never floats away from its button. It comes straight
 * after the button in the page, so Tab moves from the button into it.
 */
export function Popover({
  label,
  count = 0,
  width = 320,
  children,
}: {
  label: string;
  /** How many choices are on; the button is marked as in use when any is. */
  count?: number;
  width?: number;
  children: (close: () => void) => ReactNode;
}) {
  const [place, setPlace] = useState<Place | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const open = place !== null;

  useEffect(() => {
    if (!open) return;
    const close = () => setPlace(null);
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
      buttonRef.current?.focus();
    };
    // Scrolling inside the panel's own list is fine; scrolling the page would leave the panel behind.
    const onScroll = (event: Event) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const active = count > 0;
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={(event) => setPlace(open ? null : placeUnder(event.currentTarget, width))}
        className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold whitespace-nowrap ${
          active ? "border-primary bg-primary/10 text-primary" : "border-border-strong bg-surface hover:bg-background"
        }`}
      >
        {label}
        {active && (
          <span className="rounded-full bg-primary px-1.5 text-xs leading-5 text-white">
            {count}
            <span className="sr-only"> chosen</span>
          </span>
        )}
        <span aria-hidden className="text-xs">
          ▾
        </span>
      </button>
      {place && (
        <div
          ref={panelRef}
          id={panelId}
          role="group"
          aria-label={label}
          style={{ left: place.left, top: place.top, width: place.width, maxHeight: place.maxHeight }}
          className="fixed z-40 flex flex-col overflow-hidden rounded-xl border border-border bg-surface text-sm shadow-xl"
        >
          {children(() => setPlace(null))}
        </div>
      )}
    </>
  );
}

/** A long menu gets a search box; a short one is easier to read without. */
const SEARCH_FROM = 8;

/**
 * A filter with several choices: tick any number. Each tick applies at once and the
 * counts follow (every menu is counted under all the other filters). A choice that
 * is on but has no events under the other filters is still listed, with 0, so it
 * can be taken off.
 */
export function FilterMenu({
  label,
  options,
  chosen,
  names,
  onChange,
  loading,
  failed,
}: {
  label: string;
  options: MenuOption[];
  chosen: string[];
  /** Names for chosen values that are not among the options. */
  names?: (value: string) => string;
  onChange: (values: string[]) => void;
  loading?: boolean;
  failed?: boolean;
}) {
  return (
    <Popover label={label} count={chosen.length}>
      {(close) => (
        <MenuBody label={label} options={options} chosen={chosen} names={names} onChange={onChange} loading={loading} failed={failed} close={close} />
      )}
    </Popover>
  );
}

function MenuBody({
  label,
  options,
  chosen,
  names,
  onChange,
  loading,
  failed,
  close,
}: {
  label: string;
  options: MenuOption[];
  chosen: string[];
  names?: (value: string) => string;
  onChange: (values: string[]) => void;
  loading?: boolean;
  failed?: boolean;
  close: () => void;
}) {
  const [search, setSearch] = useState("");
  const searchId = useId();
  const missing: MenuOption[] = chosen
    .filter((value) => !options.some((option) => option.value === value))
    .map((value) => ({ value, label: names?.(value) ?? value, count: 0 }));
  const all = [...missing, ...options];
  const words = search.trim().toLowerCase();
  const shown = words ? all.filter((option) => `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(words)) : all;

  const toggle = (value: string, on: boolean) => onChange(on ? [...chosen, value] : chosen.filter((item) => item !== value));

  let lastGroup: string | null | undefined;
  return (
    <>
      {all.length >= SEARCH_FROM && (
        <div className="border-b border-border p-2">
          <label className="sr-only" htmlFor={searchId}>
            Search {label.toLowerCase()}
          </label>
          <input
            id={searchId}
            type="search"
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`Search ${label.toLowerCase()}`}
            className="w-full rounded-lg border border-border-strong px-3 py-2"
          />
        </div>
      )}
      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {loading && all.length === 0 && <li className="px-3 py-2 text-muted">Loading…</li>}
        {failed && all.length === 0 && <li className="px-3 py-2 text-danger">Could not load the choices.</li>}
        {!loading && !failed && all.length === 0 && <li className="px-3 py-2 text-muted">Nothing in this period.</li>}
        {all.length > 0 && shown.length === 0 && <li className="px-3 py-2 text-muted">No match.</li>}
        {shown.map((option) => {
          const on = chosen.includes(option.value);
          const heading = option.group && option.group !== lastGroup ? option.group : null;
          lastGroup = option.group;
          return (
            <li key={option.value}>
              {heading && <p className="px-3 pt-2 pb-1 text-xs font-semibold text-muted">{heading}</p>}
              <label className="flex cursor-pointer items-start gap-2.5 px-3 py-1.5 hover:bg-background">
                <input type="checkbox" checked={on} onChange={(event) => toggle(option.value, event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />
                <span className="min-w-0 flex-1">
                  <span className={`block ${on ? "font-semibold" : ""}`}>{option.label}</span>
                  {option.detail && <span className="block text-xs text-muted">{option.detail}</span>}
                </span>
                <span className="text-xs text-muted tabular-nums">{option.count.toLocaleString("en-IN")}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between gap-2 border-t border-border px-2 py-1.5">
        <button
          type="button"
          onClick={() => onChange([])}
          disabled={chosen.length === 0}
          className="cursor-pointer rounded-md px-2 py-1 font-semibold text-primary hover:underline disabled:cursor-default disabled:text-muted disabled:no-underline"
        >
          Clear
        </button>
        <button type="button" onClick={close} className="cursor-pointer rounded-md px-3 py-1 font-semibold hover:bg-background">
          Done
        </button>
      </div>
    </>
  );
}
