"use client";

import { createContext, use, useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Button } from "./ui";

export interface ConfirmOptions {
  /** The question, e.g. "Cancel this visit?" */
  title: string;
  /** What will happen if they go ahead, in one sentence. */
  body: string;
  /** The button that goes ahead, saying what it does, e.g. "Cancel the visit". */
  confirmLabel: string;
  /** The button that changes nothing, saying so, e.g. "Keep the visit". */
  cancelLabel: string;
}

type Ask = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Ask | null>(null);

/**
 * Returns `confirm(...)`, which asks the person before something that cannot
 * be undone and resolves to true only if they chose to go ahead:
 *
 *   if (await confirm({ title: "Cancel this visit?", body: "…", confirmLabel: "Cancel the visit", cancelLabel: "Keep the visit" })) { … }
 */
export function useConfirm(): Ask {
  const ask = use(ConfirmContext);
  if (!ask) throw new Error("useConfirm must be used inside ConfirmProvider");
  return ask;
}

/**
 * The console's one confirmation dialog, built on the browser's own <dialog>:
 * it keeps the keyboard inside while open, closes on Escape and puts the
 * cursor back where it was afterwards. The cursor starts on the safe button,
 * so pressing Enter by habit changes nothing.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<{ options: ConfirmOptions; resolve: (confirmed: boolean) => void } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const safeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  const ask = useCallback<Ask>((options) => new Promise<boolean>((resolve) => setRequest({ options, resolve })), []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!request || !dialog) return;
    if (!dialog.open) dialog.showModal();
    safeButtonRef.current?.focus();
  }, [request]);

  function answer(confirmed: boolean) {
    // Answering twice is harmless: a promise keeps its first answer.
    request?.resolve(confirmed);
    setRequest(null);
    if (dialogRef.current?.open) dialogRef.current.close();
  }

  return (
    <ConfirmContext value={ask}>
      {children}
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        // Escape closes the dialog without an answer; that counts as "no".
        onClose={() => answer(false)}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-border bg-surface p-6 text-foreground shadow-xl"
      >
        {request && (
          <>
            <h2 id={titleId} className="text-lg font-bold">
              {request.options.title}
            </h2>
            <p id={bodyId} className="mt-2 text-muted">
              {request.options.body}
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <Button ref={safeButtonRef} type="button" variant="secondary" onClick={() => answer(false)}>
                {request.options.cancelLabel}
              </Button>
              <Button type="button" variant="danger" onClick={() => answer(true)}>
                {request.options.confirmLabel}
              </Button>
            </div>
          </>
        )}
      </dialog>
    </ConfirmContext>
  );
}
