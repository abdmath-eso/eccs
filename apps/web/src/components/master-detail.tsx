import type { ReactNode } from "react";

/**
 * A list on the left and the chosen item on the right, about 2:3.
 *
 * The detail stays in view while the list scrolls, and scrolls on its own if
 * it is taller than the window. On a narrow screen (a tablet held upright, a
 * small window) there is no room for both, so the detail takes the list's
 * place and a "Back to list" link returns to it.
 */
export function MasterDetail({
  list,
  detail,
  detailLabel,
  placeholder,
  backHref,
  onBack,
}: {
  list: ReactNode;
  /** The chosen item, or `null` when nothing is chosen. */
  detail: ReactNode | null;
  /** A name for the detail area for screen readers, e.g. "Visit details". */
  detailLabel: string;
  /** What the right-hand side says while nothing is chosen. */
  placeholder: string;
  /** The address of the list with nothing chosen, so the link also works in a new tab. */
  backHref: string;
  onBack: () => void;
}) {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-5">
      <div className={`flex-col gap-3 lg:col-span-2 lg:flex ${detail ? "hidden" : "flex"}`}>{list}</div>

      {/* Stays in view just under the console's top bar, which is itself always in view. */}
      <div className="flex flex-col gap-3 lg:sticky lg:top-[calc(var(--topbar)+1rem)] lg:col-span-3 lg:max-h-[calc(100dvh-var(--topbar)-2rem)]">
        {detail ? (
          <>
            <a
              href={backHref}
              onClick={(event) => {
                event.preventDefault();
                onBack();
              }}
              className="self-start rounded-md px-2 py-1 font-semibold text-primary hover:underline lg:hidden"
            >
              ← Back to list
            </a>
            {/* Negative margin and matching padding leave room for the focus ring inside the scrolling box. */}
            {/* It can take the keyboard's focus, so it can be scrolled with the arrow keys even when it holds nothing to click. */}
            <div role="region" aria-label={detailLabel} tabIndex={0} className="lg:-m-1 lg:min-h-0 lg:overflow-y-auto lg:p-1">
              {detail}
            </div>
          </>
        ) : (
          <p className="hidden rounded-xl border border-border bg-surface p-5 text-muted lg:block">{placeholder}</p>
        )}
      </div>
    </div>
  );
}
