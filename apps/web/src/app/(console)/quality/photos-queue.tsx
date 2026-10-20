"use client";

import {
  describePhotoFlag,
  PHOTO_REJECT_REASONS,
  rejectPhotosSchema,
  type PhotoQueueDto,
  type PhotoQueueItemDto,
  type QualityCountsDto,
} from "@eccs/shared";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useToast } from "@/components/toast";
import { Button, Card, EmptyState, ErrorMessage, LoadError, Loading, SelectField, TextAreaField, ToggleGroup } from "@/components/ui";
import { api } from "@/lib/api";
import { checkAgainst } from "@/lib/forms";
import { describe, english, shortDay, when } from "@/lib/format";
import { useQuery } from "@/lib/query";

import CustomerPhotosQueue from "../customer-pages/customer-pages-screen";
import { plural } from "./quality-parts";

// Pattern followed: a moderation queue (Shopify review apps such as Clarity Reviews, Reddit's
// modqueue; AppMaster's and Logora's guidance on moderation queues): each item shown large with its
// context and the reason it is here beside it, the rule in writing beside the decision, one click
// to accept, a reason asked for a rejection (and passed on to whoever must retake it), every
// decision traceable. The founder's design (20 Oct 2026, page 5, "Photo review queue") is the card.

type Queue = "doubtful" | "customer";

const OTHER = "other";

/** The reason offered first when rejecting, from what the item is doubtful for. */
function suggestedReason(item: PhotoQueueItemDto): string {
  const codes = new Set([...item.runFlags, ...item.photos.flatMap((photo) => photo.flags)].map((flag) => flag.code));
  if (codes.has("TOO_FAST")) return PHOTO_REJECT_REASONS[4];
  if (codes.has("SAME_FILE") || codes.has("LOOKS_SAME")) return PHOTO_REJECT_REASONS[1];
  if (codes.has("FAR_FROM_OUTLET") || codes.has("MOCK_LOCATION")) return PHOTO_REJECT_REASONS[2];
  return PHOTO_REJECT_REASONS[0];
}

/**
 * Quality → Photos: one queue for every photo that needs a person. Doubtful photos (the
 * photo-integrity flags, and a checklist ticked too fast) are accepted or rejected with a retake
 * asked for; the customer-page photos (moved here from Customer pages) are approved for a
 * restaurant's QR page. Which queue is open is in the web address (`queue=`).
 */
export function PhotosTab({ counts, approvesCustomerPhotos, onChanged }: { counts: QualityCountsDto | null; approvesCustomerPhotos: boolean; onChanged: () => void }) {
  const query = useQuery();
  const queue: Queue = query.get("queue") === "customer" && approvesCustomerPhotos ? "customer" : "doubtful";

  return (
    <div className="flex flex-col gap-4">
      {approvesCustomerPhotos && (
        <ToggleGroup
          label="Which photos"
          value={queue}
          options={[
            { value: "doubtful", label: "Doubtful photos", count: counts?.photos },
            { value: "customer", label: "For customer pages", count: counts?.customerPhotos },
          ]}
          onChange={(next) => query.set({ queue: next === "customer" ? "customer" : null, show: null }, "replace")}
        />
      )}
      {queue === "customer" ? <CustomerPhotosQueue onDecided={onChanged} /> : <DoubtfulQueue onChanged={onChanged} />}
    </div>
  );
}

function DoubtfulQueue({ onChanged }: { onChanged: () => void }) {
  const [queue, setQueue] = useState<PhotoQueueDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.quality
      .photos()
      .then((next) => {
        if (cancelled) return;
        setQueue(next);
        setError(null);
      })
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  /** A judgement made: the item leaves the queue and the month's figures move on. */
  function judged(item: PhotoQueueItemDto, rejected: boolean) {
    setQueue(
      (current) =>
        current && {
          items: current.items.filter((entry) => entry.key !== item.key),
          month: { judged: current.month.judged + 1, rejected: current.month.rejected + (rejected ? 1 : 0) },
        },
    );
    onChanged();
  }

  if (!queue) return error ? <LoadError message={error} onRetry={() => setAttempt((value) => value + 1)} /> : <Loading />;

  // The oldest first: a retake is only worth asking for while the work is fresh.
  const items = [...queue.items].sort((a, b) => a.waitingSince.localeCompare(b.waitingSince));
  return (
    <div className="flex flex-col gap-4">
      {items.length === 0 ? (
        <EmptyState title="No photos are waiting">A photo comes here when the app marks it doubtful, or when a checklist is ticked too fast to be real.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-4" aria-label="Doubtful photos, oldest first">
          {items.map((item) => (
            <li key={item.key}>
              <DoubtfulCard item={item} onJudged={judged} />
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted">
        Judged this month: {queue.month.judged}, {queue.month.rejected} rejected.
      </p>
    </div>
  );
}

function DoubtfulCard({ item, onJudged }: { item: PhotoQueueItemDto; onJudged: (item: PhotoQueueItemDto, rejected: boolean) => void }) {
  const notify = useToast();
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The reason picked from the list, and the one typed for "Another reason…"; null until Reject is pressed.
  const [rejecting, setRejecting] = useState<{ picked: string; typed: string } | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);

  // The photos shown are the ones judged: one arriving since is not judged unseen.
  const photoIds = item.photos.map((photo) => photo.id);
  const labels = [...new Set(item.photos.map((photo) => (photo.itemLabel ? english(photo.itemLabel) : "")).filter(Boolean))];
  const title = [item.outletName, english(item.what), labels.length === 1 ? labels[0] : null].filter(Boolean).join(" · ");
  // Which reasons have no innocent explanation, to mark them "Certain" in words.
  const certainWords = new Set([...item.runFlags, ...item.photos.flatMap((photo) => photo.flags)].filter((flag) => flag.certain).map(describePhotoFlag));
  const takers = [...new Set(item.photos.map((photo) => photo.takenBy).filter((name): name is string => Boolean(name)))];
  const reason = rejecting ? (rejecting.picked === OTHER ? rejecting.typed.trim() : rejecting.picked) : "";

  async function accept() {
    setBusy("accept");
    setError(null);
    try {
      await api.quality.acceptPhotos({ kind: item.kind, id: item.id, photoIds });
      notify("Accepted", { detail: title });
      onJudged(item, false);
    } catch (e) {
      setError(describe(e));
      setBusy(null);
    }
  }

  async function reject() {
    const found = checkAgainst(rejectPhotosSchema, { kind: item.kind, id: item.id, photoIds, note: reason });
    if (found.note) {
      setReasonError(found.note);
      return;
    }
    setBusy("reject");
    setError(null);
    try {
      const done = await api.quality.rejectPhotos({ kind: item.kind, id: item.id, photoIds, note: reason });
      notify("Rejected, and a retake asked for", { detail: done.told > 0 ? `Told: ${item.tells}` : "Nobody could be told" });
      onJudged(item, true);
    } catch (e) {
      setError(describe(e));
      setBusy(null);
    }
  }

  const many = item.photos.length > 2;
  return (
    <Card className="flex flex-col gap-4 lg:flex-row">
      {/* The photos, large: the decision is made by looking at them. Each opens full size in a new tab. */}
      <div className="shrink-0 lg:w-1/2">
        {item.photos.length === 0 ? (
          <p className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-border-strong bg-background p-4 text-center text-muted">
            No photos on this list
          </p>
        ) : (
          // Many photos are kept small (each still opens full size), so one item never fills the screen.
          <ul className={`grid gap-3 ${many ? "grid-cols-2 sm:grid-cols-3" : item.photos.length > 1 ? "sm:grid-cols-2" : ""}`}>
            {item.photos.map((photo) => {
              const label = photo.itemLabel ? english(photo.itemLabel) : photo.kind === "BEFORE" ? "Before the work" : photo.kind === "AFTER" ? "After the work" : "Proof photo";
              return (
                <li key={photo.id} className="flex flex-col gap-1">
                  <a href={api.fileUrl(photo.path)} target="_blank" rel="noreferrer" className="block">
                    {/* A signed link to private storage that expires within the hour: not for the image optimiser. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={api.fileUrl(photo.path)}
                      alt={`${label} at ${item.outletName}. Opens full size.`}
                      className={`w-full rounded-lg border border-border bg-background ${many ? "aspect-[4/3] object-cover" : "max-h-72 object-contain"}`}
                    />
                  </a>
                  <p className={many ? "text-xs" : "text-sm"}>
                    {labels.length > 1 && <span className="font-semibold">{label} · </span>}
                    <span className="text-muted">
                      {photo.takenBy ? `${photo.takenBy}, ` : ""}
                      {when(photo.receivedAt)}
                    </span>
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          <p className="text-sm text-muted">
            {item.kind === "VISIT" ? "An ECCS visit" : "The restaurant's checklist"} on {shortDay(item.date)}
            {takers.length > 0 && ` · taken by ${takers.join(", ")}`}
            {item.visitId && (
              <>
                {" · "}
                <Link href={`/visits?visit=${encodeURIComponent(item.visitId)}`} className="font-semibold text-primary hover:underline">
                  Open the visit
                </Link>
              </>
            )}
          </p>
        </div>

        {/* Why it is here, in words; a reason with no innocent explanation says "Certain". */}
        <ul className="flex flex-col gap-1 text-sm" aria-label="Why it is here">
          {item.reasons.map((words) => {
            const certain = certainWords.has(words);
            return (
              <li key={words} className="flex items-start gap-2">
                {certain ? (
                  <span className="shrink-0 rounded-md bg-danger px-1.5 py-0.5 text-xs font-bold text-white">Certain</span>
                ) : (
                  <span aria-hidden="true" className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-foreground text-[11px] font-bold leading-none">
                    ?
                  </span>
                )}
                <span className={certain ? "font-semibold" : undefined}>{words}</span>
              </li>
            );
          })}
        </ul>

        <p className="text-sm">
          <span className="font-semibold">A rejection tells:</span> {item.tells}
        </p>

        {rejecting ? (
          <form
            className="flex flex-col gap-3 rounded-lg border border-danger p-3"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void reject();
            }}
          >
            <SelectField
              label="Why is it rejected?"
              hint={`${item.tells} reads this reason.`}
              value={rejecting.picked}
              error={rejecting.picked !== OTHER ? (reasonError ?? undefined) : undefined}
              onChange={(event) => {
                setReasonError(null);
                setRejecting({ ...rejecting, picked: event.target.value });
              }}
            >
              {PHOTO_REJECT_REASONS.map((entry) => (
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
                maxLength={300}
                autoFocus
                value={rejecting.typed}
                error={reasonError ?? undefined}
                onChange={(event) => {
                  setReasonError(null);
                  setRejecting({ ...rejecting, typed: event.target.value });
                }}
              />
            )}
            <div className="flex flex-wrap gap-2">
              {/* Red: it tells someone their work was not accepted. */}
              <Button type="submit" variant="danger" loading={busy === "reject"} disabled={busy !== null}>
                Reject and ask for a retake
              </Button>
              <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => setRejecting(null)}>
                Back
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button loading={busy === "accept"} disabled={busy !== null} onClick={() => void accept()}>
              Accept
            </Button>
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() => {
                setReasonError(null);
                setRejecting({ picked: suggestedReason(item), typed: "" });
              }}
            >
              Reject, ask to retake
            </Button>
          </div>
        )}
        <ErrorMessage message={error} />
        <p className="text-xs text-muted">Waiting since {when(item.waitingSince)}{item.photos.length > 1 ? ` · ${plural(item.photos.length, "photo")}` : ""}</p>
      </div>
    </Card>
  );
}
