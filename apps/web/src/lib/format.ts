import { ApiError } from "@eccs/api-client";

/** A failed request in words that can be shown to the person. */
export const describe = (error: unknown, fallback = "Something went wrong. Try again.") =>
  error instanceof ApiError ? (error.isNetworkError ? "Could not reach the server. Is the API running?" : error.message) : fallback;

/** Today's date in India as YYYY-MM-DD. */
export const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

/** The day after (or `days` after) a YYYY-MM-DD date. */
export function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A YYYY-MM-DD date as "Fri 9 Oct"; the year is added when it is not this year. */
export function shortDay(isoDate: string) {
  const sameYear = isoDate.slice(0, 4) === today().slice(0, 4);
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(!sameYear && { year: "numeric" }),
  })
    .format(new Date(`${isoDate.slice(0, 10)}T00:00:00Z`))
    .replace(",", "");
}

/** A date as "9 Oct 2026", for licences and documents. */
export const longDay = (isoDate: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(
    new Date(`${isoDate.slice(0, 10)}T00:00:00Z`),
  );

/** A moment as "9 Oct, 4:30 pm", in India's time. */
export const when = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));

/** True if every word typed appears somewhere in the given texts, ignoring capitals. */
export function matchesSearch(search: string, texts: readonly (string | null | undefined)[]) {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = texts.filter(Boolean).join(" ").toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** Smooth scrolling, unless the person has asked their device for less motion. */
export const scrollBehavior = (): ScrollBehavior =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
