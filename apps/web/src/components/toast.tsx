"use client";

import Link from "next/link";
import { createContext, use, useCallback, useEffect, useState, type ReactNode } from "react";

/** Long enough to read a short sentence; the message is also announced by screen readers. */
const SHOWN_FOR_MS = 6000;
/** A notification that has just arrived has two lines and a link, so it stays longer. It is also in the bell's list afterwards. */
const NEWS_SHOWN_FOR_MS = 12000;

export interface ToastOptions {
  /** "done" (the default) confirms something the person just did; "news" is a notification that has just arrived. */
  kind?: "done" | "news";
  /** A second, lighter line. */
  detail?: string;
  /** Where "Open" leads; without it there is no link. */
  href?: string;
}

type Notify = (message: string, options?: ToastOptions) => void;

const ToastContext = createContext<Notify | null>(null);

/**
 * Returns `notify("Licence renewed")`: a brief confirmation after something
 * has been saved or sent. Failures never go here; they are shown beside the
 * row or form that caused them, and stay until the person has dealt with them.
 */
export function useToast(): Notify {
  const notify = use(ToastContext);
  if (!notify) throw new Error("useToast must be used inside ToastProvider");
  return notify;
}

/** Holds the one place on the page where confirmations appear. */
export function ToastProvider({ children }: { children: ReactNode }) {
  // The number makes two identical messages in a row count as two, so the second restarts the timer.
  const [toast, setToast] = useState<({ id: number; message: string } & ToastOptions) | null>(null);

  const notify = useCallback<Notify>((message, options) => {
    setToast((current) => ({ id: (current?.id ?? 0) + 1, message, ...options }));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.kind === "news" ? NEWS_SHOWN_FOR_MS : SHOWN_FOR_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext value={notify}>
      {children}
      {/* The region is always on the page, empty or not: a screen reader only announces text added to a region it already knows. */}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
        {toast && (
          <p key={toast.id} className="pointer-events-auto flex max-w-md items-start gap-2 rounded-lg bg-foreground px-4 py-3 text-sm font-medium text-white shadow-lg">
            {toast.kind === "news" ? (
              <>
                <span aria-hidden>●</span>
                <span className="sr-only">New notification: </span>
              </>
            ) : (
              <span aria-hidden>✓</span>
            )}
            <span className="min-w-0">
              <span className="block">{toast.message}</span>
              {toast.detail && <span className="block font-normal">{toast.detail}</span>}
            </span>
            {toast.href && (
              <Link href={toast.href} onClick={() => setToast(null)} className="ml-2 shrink-0 rounded-md font-bold underline">
                Open<span className="sr-only">: {toast.message}</span>
              </Link>
            )}
          </p>
        )}
      </div>
    </ToastContext>
  );
}
