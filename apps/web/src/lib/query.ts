"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Keeps what a page is showing (the selected visit, the filters, the search)
 * in the web address, so refresh, the Back button and a copied link all bring
 * the same view back.
 *
 * The address is changed with the browser's own history methods, which Next.js
 * picks up: nothing is fetched from the server and the page does not reload.
 */
export function useQuery() {
  const pathname = usePathname();
  const params = useSearchParams();

  function merge(current: string, changes: Record<string, string | null>) {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const text = next.toString();
    return text ? `${pathname}?${text}` : pathname;
  }

  /** The address of this page with some values changed, for a link; `null` or "" removes one. */
  const hrefWith = (changes: Record<string, string | null>) => merge(params.toString(), changes);

  /**
   * Changes the address. Opening something adds a step to the browser's
   * history, so Back closes it again; a filter or search replaces the current
   * step (`replace`), so Back does not walk through every keystroke.
   */
  function set(changes: Record<string, string | null>, how: "push" | "replace" = "push") {
    // Built from the address bar itself, which is always current, so two changes made one after the other both survive.
    const href = merge(window.location.search, changes);
    if (how === "push") window.history.pushState(null, "", href);
    else window.history.replaceState(null, "", href);
  }

  return { get: (key: string) => params.get(key) ?? "", set, hrefWith };
}

/**
 * One value of the web address for a box the person types or chooses in: a
 * search box, a drop-down filter.
 *
 * The box shows what was typed at once, from its own copy, and the address is
 * brought into line behind it; reading the box straight from the address
 * would lag a keystroke behind and could drop letters. Back and Forward put
 * the address's value back into the box.
 */
export function useQueryField(key: string, how: "push" | "replace" = "replace"): [string, (value: string) => void] {
  const query = useQuery();
  const [value, setValue] = useState(query.get(key));

  useEffect(() => {
    const sync = () => setValue(new URLSearchParams(window.location.search).get(key) ?? "");
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [key]);

  return [
    value,
    (next) => {
      setValue(next);
      query.set({ [key]: next || null }, how);
    },
  ];
}

/** True for a plain left click, which the page handles itself; anything else (new tab, new window) is left to the browser. */
export const isPlainClick = (event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
