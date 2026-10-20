"use client";

import {
  PUBLIC_PAGE_REASON_MAX,
  type OrganizationDto,
  type PublicPageSettingsDto,
  type PublicPageState,
} from "@eccs/shared";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { useToast } from "@/components/toast";
import { Button, ErrorMessage, Loading, TextAreaField } from "@/components/ui";
import { api } from "@/lib/api";
import { describe, longDay, when } from "@/lib/format";

import { Tag } from "./client-editing";

type Outlet = OrganizationDto["outlets"][number];

/** Where the page stands, in a few words; the sentence after it says why. */
const STATE: Record<PublicPageState, { tag: string; line: string }> = {
  LIVE: { tag: "Showing", line: "Diners who scan the QR code see this outlet's page." },
  OFF: { tag: "Off", line: "The restaurant has not turned its page on. Only its Owner can, in the app." },
  TAKEN_DOWN: { tag: "Taken down by ECCS", line: "The restaurant cannot turn it back on until ECCS restores it." },
  INACTIVE: { tag: "Not showing", line: "This client or outlet is switched off, so diners see nothing." },
};

/**
 * One outlet's customer QR page, on its client's row: whether diners can see
 * it and why, its link, and ECCS's switch to take it down (when a client
 * leaves, or after a complaint), which the restaurant cannot override. Turning
 * a page on is the restaurant's own decision and is not offered here.
 *
 * Since 13 Oct 2026 a page shows without an ECCS inspection: it carries yesterday's
 * hygiene score, the daily checklists and photos, and the inspection once there is
 * one. So the inspection is told here as information, no longer as a reason.
 *
 * Fetched only while the client's row is open, like the plan beside it.
 */
export function OutletPublicPage({ outlet }: { outlet: Outlet }) {
  const notify = useToast();
  const [page, setPage] = useState<PublicPageSettingsDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [takingDown, setTakingDown] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.publicPage
      .get(outlet.id)
      .then((found) => {
        if (cancelled) return;
        setPage(found);
        setLoadError(null);
      })
      .catch((e) => !cancelled && setLoadError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [outlet.id, attempt]);

  if (loadError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <ErrorMessage message={`The customer page could not be loaded. ${loadError}`} />
        <Button variant="secondary" onClick={() => setAttempt((current) => current + 1)}>
          Try again
        </Button>
      </div>
    );
  }
  if (!page) return <Loading className="text-sm">Loading the customer page…</Loading>;

  async function act(action: () => Promise<PublicPageSettingsDto>, done: string) {
    setBusy(true);
    setError(null);
    try {
      setPage(await action());
      setTakingDown(false);
      setReason("");
      notify(done, { detail: outlet.name });
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  function takeDown(event: FormEvent) {
    event.preventDefault();
    if (reason.trim()) void act(() => api.publicPage.takeDown(outlet.id, reason.trim()), "Customer page taken down");
  }

  const state = STATE[page.state];
  const score = page.preview?.score ?? null;
  const inspection =
    page.inspection.state === "NONE" || !page.inspection.date
      ? "No approved inspection yet: the page says so beside the score."
      : page.inspection.state === "CURRENT"
        ? `The approved inspection of ${longDay(page.inspection.date)} is on the page${page.inspection.shownUntil ? ` until ${longDay(page.inspection.shownUntil)}` : ""}.`
        : `The approved inspection of ${longDay(page.inspection.date)} is too old to be on the page.`;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2.5 text-sm">
      <p>
        <span className="font-semibold">Customer page</span> <Tag>{state.tag}</Tag> <span className="text-muted">{state.line}</span>
      </p>
      <p className="break-all">
        Link:{" "}
        <a href={page.url} target="_blank" rel="noreferrer" className="font-semibold text-primary underline">
          {page.url}
        </a>{" "}
        <a href={`${page.url}/poster`} target="_blank" rel="noreferrer" className="text-primary underline">
          Poster to print
        </a>
      </p>
      {page.localOnly && (
        <p className="font-semibold">
          This link only works inside the office network for now. A printed QR code will not open for a diner until the console is on a hosted
          server and PUBLIC_PAGE_BASE_URL is set to its address.
        </p>
      )}
      <p className="text-muted">
        {page.preview &&
          (score
            ? `Score on the page: ${score.score} out of 100 for ${longDay(score.date)}${score.provisional ? ", with no ECCS inspection in it" : ""}. `
            : "No hygiene score on the page for the last week. ")}
        {inspection} Photos on the page: {page.photos.filter((photo) => photo.shown).length}.{" "}
        {page.photosWaiting > 0 && (
          <Link href="/quality?tab=photos&queue=customer" className="font-semibold text-primary underline">
            {page.photosWaiting} waiting for approval
          </Link>
        )}
        {page.linkChangedAt && ` The restaurant made a new link on ${when(page.linkChangedAt)}.`}
      </p>

      {page.canTakeDown &&
        (page.takenDown ? (
          <div className="flex flex-wrap items-center gap-3">
            <span>Reason on record: {page.takenDownReason ?? "none"}</span>
            <Button size="sm" variant="secondary" loading={busy} onClick={() => void act(() => api.publicPage.restore(outlet.id), "Customer page restored")}>
              Restore the page
            </Button>
          </div>
        ) : takingDown ? (
          <form onSubmit={takeDown} className="flex max-w-xl flex-col gap-2">
            <TextAreaField
              label="Why is ECCS taking this page down?"
              hint="For ECCS's own record. The restaurant is told only that ECCS has taken the page down. Diners see the same plain page as for any link with nothing to show."
              required
              rows={2}
              maxLength={PUBLIC_PAGE_REASON_MAX}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" variant="danger" loading={busy} disabled={!reason.trim()}>
                Take the page down
              </Button>
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setTakingDown(false)}>
                Keep it as it is
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <Button size="sm" variant="secondary" onClick={() => setTakingDown(true)}>
              Take the page down…
            </Button>
          </div>
        ))}
      <ErrorMessage message={error} />
    </div>
  );
}
