"use client";

import {
  durationWords,
  OUTLET_ONBOARDING_RULES,
  type OnboardingEntryKind,
  type OnboardingStepDto,
  type OnboardingStripDto,
  type OutletOnboardingBoardDto,
  type OutletOnboardingCardDto,
} from "@eccs/shared";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";

import { useToast } from "@/components/toast";
import { Button, Card, EmptyState, ErrorMessage, Field, HowItWorks, LoadError, Loading, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { describe, shortDay, when } from "@/lib/format";
import { useNavCounts } from "@/lib/nav-counts";

import { CopyButton } from "../logs/log-parts";

// Pattern followed: B2B onboarding's milestone checklist and "time to first value"
// (Valuecase's onboarding guide; customer-onboarding playbooks): each new customer is a
// card of milestones that tick themselves from what the product records, a stalled one is
// flagged early with the fix that works ("Act"), and one strip of numbers measures how fast
// customers reach first value. The founder's Onboarding page (20 Oct 2026) is the layout.

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** "3 outlets onboarding. 1 is past the 24-hour mark." */
function headline(cards: readonly OutletOnboardingCardDto[]) {
  if (cards.length === 0) return "No outlets onboarding.";
  const stuck = cards.filter((card) => card.stuck).length;
  const first = `${plural(cards.length, "outlet")} onboarding.`;
  if (stuck === 0) return `${first} None is past the 24-hour mark.`;
  return `${first} ${stuck} ${stuck === 1 ? "is" : "are"} past the 24-hour mark.`;
}

/**
 * Clients > New outlets: each outlet in its first ten days, from "won" to "running on its
 * own". Nine steps per outlet: the first six tick themselves as the restaurant uses the app,
 * the day-3 and day-10 calls and the QR posters are one tap each. An outlet not live 24 hours
 * after being added shows "Act". On day 10 it leaves this tab and is an ordinary row on Health.
 */
export default function NewOutletsScreen({ tabs }: { tabs?: ReactNode }) {
  const notify = useToast();
  const { refresh: refreshCounts } = useNavCounts();
  const [board, setBoard] = useState<OutletOnboardingBoardDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.outletOnboarding
      .board()
      .then((next) => {
        if (cancelled) return;
        setBoard(next);
        setError(null);
      })
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  /** A card the server sent back after a tap replaces the one shown. */
  function changed(card: OutletOnboardingCardDto, message: string) {
    setBoard((current) => current && { ...current, cards: current.cards.map((one) => (one.outletId === card.outletId ? card : one)) });
    refreshCounts();
    notify(message);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Clients" description="New outlets, from “won” to “running on its own”, in their first ten days." />
      {tabs}

      {!board && (error ? <LoadError message={error} onRetry={() => setAttempt((value) => value + 1)} /> : <Loading />)}

      {board && (
        <>
          <h2 className="text-xl font-bold">{headline(board.cards)}</h2>
          <Strip strip={board.strip} />

          {board.cards.length === 0 ? (
            <EmptyState title="No outlets in their first ten days">
              An outlet added through Onboard a restaurant or Add an outlet appears here by itself, with its nine steps.
            </EmptyState>
          ) : (
            <ul className="grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-3" aria-label="Outlets onboarding">
              {board.cards.map((card) => (
                <li key={card.outletId}>
                  <OnboardingCard card={card} onChanged={changed} />
                </li>
              ))}
            </ul>
          )}

          {board.toStart.length > 0 && <ToStart outlets={board.toStart} onStarted={(next) => setBoard(next)} />}

          <HowItWorks>
            <p>
              Steps 1 to 6 tick themselves from what the apps record: the outlet and its code; the Owner&apos;s first login with their PIN; a Manager and a Head
              Chef added with their PINs; everyone at the outlet agreeing to the terms and privacy; every licence the outlet has with a copy filed, and at least
              the FSSAI; and the first checklist handed in with proof photos. With all six the outlet is live.
            </p>
            <p>
              The day-3 call, the QR posters and the day-10 call are one tap each, with a note if you like. An outlet not live {OUTLET_ONBOARDING_RULES.liveWithinHours}{" "}
              hours after being added shows Act: visit and set it up in person, or call the Owner. Day 0 is the day it was added; after day{" "}
              {OUTLET_ONBOARDING_RULES.days} it leaves this tab and is an ordinary row on Health.
            </p>
            <p>
              Still using the app at day 10 means a checklist handed in on at least {OUTLET_ONBOARDING_RULES.stillUsing.minDays} of the{" "}
              {OUTLET_ONBOARDING_RULES.stillUsing.lastDays} days up to day 10, counted over the outlets whose day 10 came in the last 30 days.
            </p>
          </HowItWorks>
        </>
      )}
    </div>
  );
}

// ───────────────────────── The strip ─────────────────────────

/** The one line of numbers: how fast new outlets reach "first value". */
function Strip({ strip }: { strip: OnboardingStripDto }) {
  const first = strip.firstChecklist;
  return (
    <dl className="grid gap-x-3 gap-y-2 rounded-xl border border-border bg-surface p-4 sm:grid-cols-3">
      <Figure label="Onboarded this month" value={plural(strip.onboarded, "outlet")} note={`${strip.liveWithin24h} live within 24 hours`} />
      <Figure
        label="Time to first checklist"
        value={first ? durationWords(first.medianHours) : "None yet"}
        note={first ? (first.counted === 1 ? "one outlet so far" : `median · best ${durationWords(first.bestHours)}, worst ${durationWords(first.worstHours)}`) : "no checklist with photos yet"}
      />
      <Figure
        label="Still using the app at day 10"
        value={strip.stillUsing.of === 0 ? "None yet" : `${strip.stillUsing.yes} of ${strip.stillUsing.of}`}
        note={`a checklist on ${OUTLET_ONBOARDING_RULES.stillUsing.minDays} of the last ${OUTLET_ONBOARDING_RULES.stillUsing.lastDays} days`}
      />
    </dl>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-xl font-bold sm:text-2xl">{value}</dd>
      <dd className="text-sm text-muted">{note}</dd>
    </div>
  );
}

// ───────────────────────── One outlet ─────────────────────────

/** The badge in words with its own mark, so it never rests on colour alone. */
function LiveBadge({ card }: { card: OutletOnboardingCardDto }) {
  const [mark, text, style] = card.live
    ? ["✓", `Live in ${durationWords(card.liveAfterHours ?? 0)}`, "border-primary text-primary"]
    : card.stuck
      ? ["!", `Not live, ${durationWords(card.hoursSinceAdded)}`, "border-danger bg-danger text-white"]
      : ["○", `Not live yet, ${durationWords(card.hoursSinceAdded)}`, "border-border-strong text-muted"];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${style}`}>
      <span aria-hidden>{mark}</span>
      {text}
    </span>
  );
}

function OnboardingCard({ card, onChanged }: { card: OutletOnboardingCardDto; onChanged: (card: OutletOnboardingCardDto, message: string) => void }) {
  const titleId = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(key: string, action: () => Promise<OutletOnboardingCardDto>, message: string) {
    setBusy(key);
    setError(null);
    try {
      onChanged(await action(), message);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  const log = (kind: OnboardingEntryKind, note: string | undefined, message: string) =>
    act(kind, () => api.outletOnboarding.log(card.outletId, { kind, ...(note && { note }) }), message);
  const undo = (step: OnboardingStepDto) =>
    step.entryId && act(`undo-${step.key}`, () => api.outletOnboarding.undo(card.outletId, step.entryId!), `${step.title}: taken back`);

  const sameName = card.outletName.toLowerCase().startsWith(card.organizationName.toLowerCase());
  const about = [
    sameName ? null : card.organizationName,
    card.area,
    card.wonBy ? `won ${shortDay(card.wonBy.on)} by ${card.wonBy.name}` : null,
    card.planName,
  ].filter(Boolean);
  const day = card.day === 0 ? "added today" : `day ${card.day} of ${OUTLET_ONBOARDING_RULES.days}`;

  return (
    <Card className={`flex flex-col gap-3 ${card.stuck ? "border-2 border-danger" : ""}`}>
      <section aria-labelledby={titleId} className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id={titleId} className="font-bold">
              {card.outletName}
            </h3>
            {about.length > 0 && <p className="text-sm text-muted">{about.join(" · ")}</p>}
          </div>
          <LiveBadge card={card} />
        </div>

        <div className="flex flex-col gap-1">
          <div aria-hidden className="h-2 overflow-hidden rounded-full bg-background">
            <div className={`h-full rounded-full ${card.stuck ? "bg-danger" : "bg-primary"}`} style={{ width: `${(card.stepsDone / card.steps.length) * 100}%` }} />
          </div>
          <p className="text-sm text-muted">
            {card.stepsDone} of {card.steps.length} steps · {day}
          </p>
        </div>

        <ol className="flex flex-col">
          {card.steps.map((step) => (
            <StepRow key={step.key} step={step} busy={busy} onLog={log} onUndo={undo} />
          ))}
        </ol>

        {card.notes.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-border pt-3">
            <h4 className="text-sm font-semibold text-muted">Notes</h4>
            <ul className="flex flex-col gap-1 text-sm">
              {card.notes.map((note) => (
                <li key={note.id}>
                  {note.note ?? "Note"}
                  <span className="text-muted">
                    {" "}
                    · {when(note.at)}
                    {note.by ? ` · ${note.by}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {card.stuck && <Act card={card} busy={busy} onLog={log} />}
        <ErrorMessage message={error} />
      </section>
    </Card>
  );
}

/** What a done step says under its name: when, who, and its few words. */
function stepLine(step: OnboardingStepDto): string {
  if (step.done) return [step.at ? when(step.at) : null, step.by, step.detail].filter(Boolean).join(" · ");
  return [step.detail, step.dueOn ? `due ${shortDay(step.dueOn)}` : null].filter(Boolean).join(" · ") || "Not yet";
}

const MANUAL: Partial<Record<OnboardingStepDto["key"], { kind: OnboardingEntryKind; button: string; done: string }>> = {
  DAY3_CALL: { kind: "DAY3_CALL", button: "Log the call", done: "Day-3 call logged" },
  POSTERS: { kind: "POSTERS", button: "Mark as delivered", done: "QR posters marked as delivered" },
  DAY10_CALL: { kind: "DAY10_CALL", button: "Log the call", done: "Day-10 call logged" },
};

function StepRow({
  step,
  busy,
  onLog,
  onUndo,
}: {
  step: OnboardingStepDto;
  busy: string | null;
  onLog: (kind: OnboardingEntryKind, note: string | undefined, message: string) => void;
  onUndo: (step: OnboardingStepDto) => void;
}) {
  const manual = MANUAL[step.key];
  // The calls take an optional note ("chef wants Telugu labels"); the posters are a plain tap.
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");

  function save(event: FormEvent) {
    event.preventDefault();
    if (!manual) return;
    onLog(manual.kind, note.trim() || undefined, manual.done);
    setNoting(false);
    setNote("");
  }

  return (
    <li className="flex gap-3 border-t border-border py-2 first:border-t-0">
      <span
        aria-hidden
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          step.done ? "bg-primary text-white" : "border border-border-strong text-muted"
        }`}
      >
        {step.done ? "✓" : step.number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className={`text-sm ${step.done ? "font-semibold" : "font-medium"}`}>
          <span className="sr-only">
            Step {step.number}, {step.done ? "done" : "not done"}:{" "}
          </span>
          {step.title}
        </p>
        <p className="text-sm text-muted">{stepLine(step)}</p>
        {manual && !step.done && !noting && (
          <div>
            <Button
              size="sm"
              variant="secondary"
              loading={busy === manual.kind}
              disabled={busy !== null}
              onClick={() => (manual.kind === "POSTERS" ? onLog(manual.kind, undefined, manual.done) : setNoting(true))}
            >
              {manual.button}
            </Button>
          </div>
        )}
        {manual && noting && (
          <form onSubmit={save} className="flex flex-col gap-2">
            <Field label="Note" value={note} maxLength={OUTLET_ONBOARDING_RULES.noteMax} onChange={(e) => setNote(e.target.value)} autoFocus hint="What was said, in a few words." />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" loading={busy === manual.kind}>
                Save the call
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setNoting(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
        {manual && step.done && step.entryId && (
          <div>
            <Button variant="link" className="-ml-2 text-sm" disabled={busy !== null} onClick={() => onUndo(step)}>
              Undo
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

/** For an outlet not live 24 hours after being added: the two fixes that work. */
function Act({ card, busy, onLog }: { card: OutletOnboardingCardDto; busy: string | null; onLog: (kind: OnboardingEntryKind, note: string | undefined, message: string) => void }) {
  const [calling, setCalling] = useState(false);
  const owner = card.owner;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-danger/40 bg-danger/5 p-3">
      <p className="text-sm font-semibold text-danger">
        <span aria-hidden>! </span>Act: not live {durationWords(card.hoursSinceAdded)} after being added.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={busy === "NOTE"} disabled={busy !== null} onClick={() => onLog("NOTE", "Visit and set up in person", "Noted: visit and set up in person")}>
          Visit and set up in person
        </Button>
        <Button size="sm" variant="secondary" aria-expanded={calling} onClick={() => setCalling((open) => !open)}>
          Call the Owner
        </Button>
      </div>
      {calling &&
        (owner?.phone ? (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span>
              {owner.name}: <span className="font-mono font-semibold select-all">{owner.phone}</span>
            </span>
            <CopyButton value={owner.phone} label="Copy the number" />
            <a href={`tel:${owner.phone}`} className="rounded-md px-1 font-semibold text-primary hover:underline">
              Call
            </a>
          </p>
        ) : (
          <p className="text-sm text-muted">No number on file for the Owner. Add it under All clients.</p>
        ))}
    </div>
  );
}

// ───────────────────────── Outlets added before onboarding started by itself ─────────────────────────

function ToStart({ outlets, onStarted }: { outlets: OutletOnboardingBoardDto["toStart"]; onStarted: (board: OutletOnboardingBoardDto) => void }) {
  const notify = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(outlet: OutletOnboardingBoardDto["toStart"][number]) {
    setBusy(outlet.outletId);
    setError(null);
    try {
      onStarted(await api.outletOnboarding.start(outlet.outletId));
      notify(`Onboarding started for ${outlet.outletName}`);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-bold">Added in the last ten days, not followed here</h2>
        <p className="text-sm text-muted">Outlets added before New outlets existed. Start one to follow its steps.</p>
      </div>
      <ul className="flex flex-col">
        {outlets.map((outlet) => (
          <li key={outlet.outletId} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 first:border-t-0">
            <span>
              <span className="font-semibold">{outlet.outletName}</span>
              <span className="text-sm text-muted">
                {" "}
                · {outlet.organizationName} · added {when(outlet.addedAt)}
              </span>
            </span>
            <Button size="sm" variant="secondary" loading={busy === outlet.outletId} disabled={busy !== null} onClick={() => void start(outlet)}>
              Start onboarding
            </Button>
          </li>
        ))}
      </ul>
      <ErrorMessage message={error} />
    </Card>
  );
}
