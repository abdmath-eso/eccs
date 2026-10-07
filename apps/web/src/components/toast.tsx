"use client";

import { createContext, use, useCallback, useEffect, useState, type ReactNode } from "react";

/** Long enough to read a short sentence; the message is also announced by screen readers. */
const SHOWN_FOR_MS = 6000;

const ToastContext = createContext<((message: string) => void) | null>(null);

/**
 * Returns `notify("Licence renewed")`: a brief confirmation after something
 * has been saved or sent. Failures never go here; they are shown beside the
 * row or form that caused them, and stay until the person has dealt with them.
 */
export function useToast(): (message: string) => void {
  const notify = use(ToastContext);
  if (!notify) throw new Error("useToast must be used inside ToastProvider");
  return notify;
}

/** Holds the one place on the page where confirmations appear. */
export function ToastProvider({ children }: { children: ReactNode }) {
  // The number makes two identical messages in a row count as two, so the second restarts the timer.
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);

  const notify = useCallback((message: string) => {
    setToast((current) => ({ id: (current?.id ?? 0) + 1, message }));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), SHOWN_FOR_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext value={notify}>
      {children}
      {/* The region is always on the page, empty or not: a screen reader only announces text added to a region it already knows. */}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
        {toast && (
          <p key={toast.id} className="pointer-events-auto flex max-w-md items-start gap-2 rounded-lg bg-foreground px-4 py-3 text-sm font-medium text-white shadow-lg">
            <span aria-hidden>✓</span>
            <span>{toast.message}</span>
          </p>
        )}
      </div>
    </ToastContext>
  );
}
