"use client";

import {
  can,
  PUBLIC_PAGE_REASON_MAX,
  PUBLIC_PAGE_RULES,
  PUBLIC_PHOTO_REJECT_REASONS,
  PUBLIC_PHOTO_RULE,
  type PublicPhotoCaption,
  type PublicPhotoDto,
  type PublicPhotoStatus,
} from "@eccs/shared";
import { useEffect, useState } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { Button, Card, EmptyState, ErrorMessage, LoadError, Loading, NoAccess, PageHeader, SelectField, TextAreaField, ToggleGroup } from "@/components/ui";
import { api } from "@/lib/api";
import { describe, when } from "@/lib/format";
import { useNavCounts } from "@/lib/nav-counts";
import { useQuery } from "@/lib/query";
import { useSession } from "@/lib/session";

/** What a photo shows, in the console's English. The diner's page words these in their own language. */
export const CAPTION: Record<PublicPhotoCaption, string> = {
  GRILL: "Grill",
  HOOD: "Hood and exhaust",
  COLD_STORAGE: "Cold storage",
  PREP_AREA: "Preparation area",
  FLOOR_DRAINS: "Floor and drains",
  WASH_AREA: "Washing area",
};

const SHOWS: readonly { value: PublicPhotoStatus; label: string }[] = [
  { value: "PROPOSED", label: "Waiting" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
];

const OTHER = "other";

/**
 * Customer pages: the photos Supervisors have proposed for restaurants'
 * public QR pages, waiting for ECCS's decision, the longest-waiting first.
 *
 * Laid out as review queues are in moderation tools (Discourse's review queue,
 * the "queue and detail" pattern): each photo is shown large, because the
 * decision is made by looking at it; the rule it is judged by stays in view
 * beside it instead of living in someone's head; approving is one click, and
 * rejecting asks for the reason, which the Supervisor is shown.
 *
 * The filter is kept in the web address as `show=`.
 */
export default function CustomerPagesScreen() {
  const { user } = useSession();
  const notify = useToast();
  const confirm = useConfirm();
  const query = useQuery();
  const { refresh: refreshCounts } = useNavCounts();

  const [photos, setPhotos] = useState<PublicPhotoDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  // The photo being rejected, the reason picked from the list, and the reason typed.
  const [rejecting, setRejecting] = useState<{ id: string; picked: string; typed: string } | null>(null);

  const mayDecide = user ? can(user.memberships, "publicPage", "approve") : false;
  const asked = query.get("show") as PublicPhotoStatus;
  const show: PublicPhotoStatus = SHOWS.some((entry) => entry.value === asked) ? asked : "PROPOSED";

  useEffect(() => {
    if (!mayDecide) return;
    let cancelled = false;
    api.publicPage
      .photos({ status: show })
      .then((list) => {
        if (cancelled) return;
        setPhotos(list);
        setError(null);
      })
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [mayDecide, show, attempt]);

  if (!mayDecide) {
    return <NoAccess title="Customer pages">Photos for customer pages are approved by Super Admins and Operations Managers.</NoAccess>;
  }

  /** Makes one decision, then takes the photo out of the list it was in. */
  async function decide(photo: PublicPhotoDto, action: () => Promise<unknown>, done: string) {
    setBusy(photo.id);
    setRowError(null);
    try {
      await action();
      setPhotos((current) => current?.filter((entry) => entry.id !== photo.id) ?? null);
      setRejecting(null);
      notify(done, { detail: `${photo.organizationName}, ${photo.outletName}` });
      refreshCounts();
    } catch (e) {
      setRowError({ id: photo.id, message: describe(e) });
    } finally {
      setBusy(null);
    }
  }

  async function remove(photo: PublicPhotoDto) {
    const sure = await confirm({
      title: "Take this photo off the page?",
      body: `It comes off ${photo.organizationName}'s customer page straight away and cannot be put back; the Supervisor would have to propose a new one.`,
      confirmLabel: "Take the photo off",
      cancelLabel: "Keep the photo",
    });
    if (sure) await decide(photo, () => api.publicPage.removePhoto(photo.id), "Photo taken off the page");
  }

  const reason = rejecting ? (rejecting.picked === OTHER ? rejecting.typed.trim() : rejecting.picked) : "";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Customer pages"
        description="Photos proposed for restaurants' public QR pages. Nothing appears to a diner until it is approved here."
        how={
          <>
            <p>
              A Supervisor proposes photos from a finished visit or inspection, or takes one for the purpose. Each waits here until a Super Admin or
              Operations Manager approves or rejects it. A page shows its newest {PUBLIC_PAGE_RULES.maxPhotos} approved photos.
            </p>
            <p>
              The restaurant&apos;s Owner can remove any approved photo from their page at any time, and so can ECCS. A decision is final: a rejected
              or removed photo cannot be proposed again.
            </p>
            <p>Whether a client&apos;s page is on, its link, and the switch to take it down are on the client&apos;s outlet, under Clients.</p>
          </>
        }
      />

      <ToggleGroup
        label="Which photos to show"
        value={show}
        options={SHOWS}
        onChange={(next) => {
          setPhotos(null);
          setRejecting(null);
          query.set({ show: next === "PROPOSED" ? null : next }, "replace");
        }}
      />

      <LoadError message={error} onRetry={() => setAttempt((current) => current + 1)} />
      {photos === null && !error && <Loading />}

      {photos !== null && photos.length === 0 && (
        <EmptyState title={show === "PROPOSED" ? "No photos are waiting" : show === "APPROVED" ? "No approved photos" : "No rejected photos"}>
          {show === "PROPOSED" ? "A photo appears here when a Supervisor proposes one from the app, on a finished visit or inspection." : undefined}
        </EmptyState>
      )}

      {photos?.map((photo) => (
        <Card key={photo.id} className="flex flex-col gap-4 lg:flex-row">
          {/* The photo, large: the decision is made by looking at it. It opens full size in a new tab. */}
          <a href={api.fileUrl(photo.path)} target="_blank" rel="noreferrer" className="block shrink-0 lg:w-3/5">
            {/* A signed link to private storage that expires within the hour: not something the image optimiser can fetch or should cache. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={api.fileUrl(photo.path)}
              alt={`${CAPTION[photo.caption]} at ${photo.organizationName}, ${photo.outletName}. Opens full size.`}
              className="max-h-[70vh] w-full rounded-lg border border-border bg-background object-contain"
            />
          </a>

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div>
              <h2 className="text-lg font-bold">{CAPTION[photo.caption]}</h2>
              <p>
                {photo.organizationName}, {photo.outletName}
              </p>
              <p className="text-sm text-muted">
                Proposed by {photo.proposedByName ?? "a Supervisor"} on {when(photo.proposedAt)}
              </p>
              {photo.status !== "PROPOSED" && photo.decidedAt && (
                <p className="text-sm text-muted">
                  {photo.status === "APPROVED" ? "Approved" : "Rejected"} on {when(photo.decidedAt)}
                  {photo.rejectReason ? `: ${photo.rejectReason}` : ""}
                </p>
              )}
              {photo.status === "APPROVED" && (
                <p className="text-sm font-semibold">
                  {photo.removed ? "Removed from the page" : photo.shown ? "On the page now" : `Approved, but not among the newest ${PUBLIC_PAGE_RULES.maxPhotos} shown`}
                </p>
              )}
            </div>

            {photo.status === "PROPOSED" && (
              <>
                {/* The rule stays beside the photo it is applied to. */}
                <div className="rounded-lg border-2 border-foreground px-3 py-2">
                  <p className="text-sm font-semibold">Approve only if all of this is true</p>
                  <p>{PUBLIC_PHOTO_RULE}</p>
                  <p className="mt-1 text-sm text-muted">Look at reflections, the background and anything written on walls or uniforms. If in doubt, reject.</p>
                </div>

                {rejecting?.id === photo.id ? (
                  <form
                    className="flex flex-col gap-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (reason) void decide(photo, () => api.publicPage.rejectPhoto(photo.id, reason), "Photo rejected");
                    }}
                  >
                    <SelectField
                      label="Why is it rejected?"
                      hint="The Supervisor who proposed it sees this. The restaurant does not."
                      value={rejecting.picked}
                      onChange={(event) => setRejecting({ ...rejecting, picked: event.target.value })}
                    >
                      {PUBLIC_PHOTO_REJECT_REASONS.map((entry) => (
                        <option key={entry} value={entry}>
                          {entry}
                        </option>
                      ))}
                      <option value={OTHER}>Another reason…</option>
                    </SelectField>
                    {rejecting.picked === OTHER && (
                      <TextAreaField
                        label="The reason"
                        required
                        rows={2}
                        maxLength={PUBLIC_PAGE_REASON_MAX}
                        value={rejecting.typed}
                        onChange={(event) => setRejecting({ ...rejecting, typed: event.target.value })}
                      />
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" variant="danger" loading={busy === photo.id} disabled={!reason}>
                        Reject the photo
                      </Button>
                      <Button type="button" variant="secondary" disabled={busy === photo.id} onClick={() => setRejecting(null)}>
                        Back
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      loading={busy === photo.id}
                      disabled={busy !== null && busy !== photo.id}
                      onClick={() => void decide(photo, () => api.publicPage.approvePhoto(photo.id), "Photo approved")}
                    >
                      Approve for the page
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() => setRejecting({ id: photo.id, picked: PUBLIC_PHOTO_REJECT_REASONS[0], typed: "" })}
                    >
                      Reject…
                    </Button>
                  </div>
                )}
              </>
            )}

            {photo.status === "APPROVED" && !photo.removed && (
              <div>
                <Button variant="secondary" loading={busy === photo.id} disabled={busy !== null && busy !== photo.id} onClick={() => void remove(photo)}>
                  Take off the page…
                </Button>
              </div>
            )}

            <ErrorMessage message={rowError?.id === photo.id ? rowError.message : null} />
          </div>
        </Card>
      ))}
    </div>
  );
}
