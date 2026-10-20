"use client";

import {
  bookFollowUpVisitSchema,
  closeFollowUpSchema,
  indiaDay,
  logFollowUpCallSchema,
  QUALITY_RULES,
  visitWhenWords,
  type FollowUpDto,
  type FollowUpsDto,
  type ServiceTypeDto,
  type SupervisorDto,
  type VisitSlot,
} from "@eccs/shared";
import Link from "next/link";
import { useEffect, useState, type FormEvent, type MouseEvent } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { MasterDetail } from "@/components/master-detail";
import { useToast } from "@/components/toast";
import { Button, Card, EmptyState, ErrorMessage, LoadError, Loading, SelectField, TextAreaField, ToggleGroup } from "@/components/ui";
import { api } from "@/lib/api";
import { checkAgainst, focusFirstError, hasErrors, type FieldErrors } from "@/lib/forms";
import { addDays, describe, english, shortDay, today, when } from "@/lib/format";
import { isPlainClick, useQuery } from "@/lib/query";
import { useSession } from "@/lib/session";

import { checkDate, StatusBadge, WhenAndWho } from "../visits/visit-parts";
import { plural, sinceWords, sourceLink, StandingBadge } from "./quality-parts";

// Pattern followed: ServiceTitan's recall and callback handling (a callback is booked from the
// original job, linked to it and marked "no charge", and tracked until it is done) and its callback
// guide (call the customer first, log what was said, then send someone). The founder's design
// (20 Oct 2026, page 5, "Re-inspection queue", renamed Follow-ups because there is no
// re-inspection) is the table; a row opens beside the list as in Visits (the master-detail pattern).

type State = "open" | "done";

/** A link that looks like a lesser button, for a row's one action. */
const ACTION_LINK =
  "inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-background";

/**
 * Quality → Follow-ups: the kitchens to call back, nothing booked first, the longest waiting
 * first; or, with Done, those done or closed in the last 30 days, read-only. The open one is in
 * the web address (`followUp=`), beside the list, so Today's Open and a copied link bring it back.
 */
export function FollowUpsTab({ onChanged }: { onChanged: () => void }) {
  const query = useQuery();
  const notify = useToast();
  const state: State = query.get("state") === "done" ? "done" : "open";
  const followUpId = query.get("followUp");

  const [loaded, setLoaded] = useState<{ state: State; data: FollowUpsDto } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // The open follow-up as fetched on its own (not in this list) or as an action sent it back.
  const [fetched, setFetched] = useState<FollowUpDto | null>(null);
  const [detailError, setDetailError] = useState<{ id: string; message: string } | null>(null);
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [types, setTypes] = useState<ServiceTypeDto[]>([]);
  const [supervisors, setSupervisors] = useState<SupervisorDto[]>([]);

  useEffect(() => {
    let cancelled = false;
    api.quality
      .followUps(state)
      .then((data) => {
        if (cancelled) return;
        setLoaded({ state, data });
        setError(null);
      })
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [state, attempt]);

  useEffect(() => {
    // For booking a free visit: the kinds of service and who can be sent.
    api.services
      .types()
      .then(setTypes)
      .catch(() => undefined);
    api.services
      .supervisors()
      .then(setSupervisors)
      .catch(() => undefined);
  }, []);

  const data = loaded?.state === state ? loaded.data : null;
  const listed = data?.items.find((item) => item.id === followUpId) ?? null;
  const opened = fetched?.id === followUpId ? fetched : listed;
  const ready = data !== null;
  const have = opened !== null;

  // A follow-up not in this list (a link from Today or the Logs to one since closed) is fetched on its own.
  useEffect(() => {
    if (!followUpId || !ready || have) return;
    let cancelled = false;
    api.quality
      .followUp(followUpId)
      .then((next) => !cancelled && setFetched(next))
      .catch((e) => !cancelled && setDetailError({ id: followUpId, message: describe(e) }));
    return () => {
      cancelled = true;
    };
  }, [followUpId, ready, have, detailAttempt]);

  /** An action's answer: shown in the panel, put in the list (or taken out of the queue once it has left it). */
  function changed(next: FollowUpDto, message: string) {
    setFetched(next);
    setLoaded(
      (current) =>
        current && {
          ...current,
          data: {
            ...current.data,
            items: current.data.items.flatMap((item) => (item.id !== next.id ? [item] : current.state === "open" && next.status !== "OPEN" ? [] : [next])),
          },
        },
    );
    notify(message, { detail: next.outletName });
    onChanged();
  }

  const linkFor = (id: string) => query.hrefWith({ followUp: id });
  const open = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    if (id !== followUpId) query.set({ followUp: id });
  };

  const openError = detailError && detailError.id === followUpId ? detailError.message : null;
  const panel = opened ? (
    <FollowUpPanel key={opened.id} followUp={opened} callers={data?.callers ?? []} types={types} supervisors={supervisors} onChanged={changed} />
  ) : openError ? (
    <Card className="flex flex-col items-start gap-3">
      <ErrorMessage message={openError} />
      <Button
        variant="secondary"
        onClick={() => {
          setDetailError(null);
          setDetailAttempt((value) => value + 1);
        }}
      >
        Try again
      </Button>
    </Card>
  ) : followUpId ? (
    <Card>
      <Loading>Opening the follow-up…</Loading>
    </Card>
  ) : null;

  const items = data?.items ?? [];
  const list = (
    <>
      {error && <LoadError message={error} onRetry={() => setAttempt((value) => value + 1)} />}
      {!data && !error && <Loading />}
      {data && items.length === 0 && (
        <EmptyState title={state === "open" ? "No kitchen needs a follow-up" : "Nothing done or closed lately"}>
          {state === "open"
            ? "A kitchen comes in by itself when a visit is rated low, an issue is reopened, its score falls, or an inspection ends with no grade."
            : `Follow-ups done or closed in the last ${QUALITY_RULES.doneShownDays} days show here.`}
        </EmptyState>
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* On a narrow screen an open follow-up takes the whole tab; "Back to list" brings the list back. */}
      <div className={followUpId ? "hidden lg:block" : undefined}>
        <ToggleGroup
          label="Which follow-ups to show"
          value={state}
          options={[
            { value: "open", label: "Open" },
            { value: "done", label: "Done" },
          ]}
          onChange={(value) => query.set({ state: value === "done" ? "done" : null, followUp: null }, "replace")}
        />
      </div>

      {followUpId ? (
        <MasterDetail
          detail={panel}
          detailLabel="Follow-up"
          placeholder="Choose a follow-up to call, book or close it."
          backHref={query.hrefWith({ followUp: null })}
          onBack={() => query.set({ followUp: null })}
          list={
            <>
              {list}
              <FollowUpCards items={items} selectedId={followUpId} linkFor={linkFor} onOpen={open} />
            </>
          }
        />
      ) : (
        <>
          {list}
          {items.length > 0 && (
            <>
              <div className="md:hidden">
                <FollowUpCards items={items} selectedId={null} linkFor={linkFor} onOpen={open} />
              </div>
              <div className="hidden md:block">
                <FollowUpTable items={items} done={state === "done"} linkFor={linkFor} onOpen={open} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** "Jubilee Hills · score 51". */
const whereWords = (item: FollowUpDto) => [item.area, item.score !== null ? `score ${item.score}` : null].filter(Boolean).join(" · ");

/** How a done or closed one ended: "Free visit done", "Closed: settled on the phone". */
const endedWords = (item: FollowUpDto) => `${item.standingWords}${item.status === "CLOSED" && item.closeNote ? `: ${item.closeNote}` : ""}`;

type Opener = (event: MouseEvent<HTMLAnchorElement>, id: string) => void;

/** The list as cards: on a phone, and beside an open follow-up. */
function FollowUpCards({ items, selectedId, linkFor, onOpen }: { items: readonly FollowUpDto[]; selectedId: string | null; linkFor: (id: string) => string; onOpen: Opener }) {
  return (
    <ul className="flex flex-col gap-2" aria-label="Follow-ups">
      {items.map((item) => {
        const selected = item.id === selectedId;
        return (
          <li key={item.id}>
            <a
              href={linkFor(item.id)}
              onClick={(event) => onOpen(event, item.id)}
              aria-current={selected ? "true" : undefined}
              className={`block rounded-xl border bg-surface p-4 hover:border-primary ${selected ? "border-primary ring-2 ring-primary" : "border-border"}`}
            >
              <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <span className="font-semibold">{item.outletName}</span>
                <StandingBadge standing={item.standing} words={item.standingWords} />
              </span>
              <span className="mt-1 block text-sm">{item.reason}</span>
              <span className="mt-1 block text-sm text-muted">
                {[
                  whereWords(item),
                  item.status !== "OPEN" ? null : item.sinceDays <= 0 ? "came in today" : `waiting ${plural(item.sinceDays, "day")}`,
                  item.status === "OPEN" ? (item.told ?? "nothing told yet") : endedWords(item),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** The design's table, on a wide screen with nothing open. */
function FollowUpTable({ items, done, linkFor, onOpen }: { items: readonly FollowUpDto[]; done: boolean; linkFor: (id: string) => string; onOpen: Opener }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{done ? "Follow-ups done or closed lately" : "Kitchens to follow up, nothing booked first"}</caption>
        <thead className="text-muted">
          <tr className="border-b border-border">
            <th scope="col" className="px-4 py-2.5 font-medium">Outlet</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Why it is here</th>
            {done ? (
              <th scope="col" className="px-3 py-2.5 font-medium">How it ended</th>
            ) : (
              <>
                <th scope="col" className="px-3 py-2.5 font-medium">Since</th>
                <th scope="col" className="px-3 py-2.5 font-medium">What the kitchen was told</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Follow-up</th>
              </>
            )}
            <th scope="col" className="px-4 py-2.5 font-medium">
              <span className="sr-only">What to do</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const source = sourceLink(item.source);
            return (
              <tr key={item.id} className="border-b border-border align-top last:border-0">
                <td className="px-4 py-2.5">
                  <a href={linkFor(item.id)} onClick={(event) => onOpen(event, item.id)} className="font-semibold text-primary hover:underline">
                    {item.outletName}
                  </a>
                  {whereWords(item) && <span className="block text-muted">{whereWords(item)}</span>}
                </td>
                <td className="max-w-md px-3 py-2.5">
                  <Link href={source.href} className="hover:underline">
                    {item.reason}
                    <span className="sr-only">: {source.label.toLowerCase()}</span>
                  </Link>
                </td>
                {done ? (
                  <td className="max-w-sm px-3 py-2.5">
                    {endedWords(item)}
                    {item.closedAt && <span className="block text-muted">{when(item.closedAt)}</span>}
                  </td>
                ) : (
                  <>
                    <td className="px-3 py-2.5 whitespace-nowrap">{sinceWords(item.sinceDays)}</td>
                    <td className="max-w-xs px-3 py-2.5">{item.told ?? <span className="text-muted">Nothing yet</span>}</td>
                    <td className="px-3 py-2.5">
                      <StandingBadge standing={item.standing} words={item.standingWords} />
                    </td>
                  </>
                )}
                <td className="px-4 py-2.5 text-right">
                  {!done && item.standing === "NOT_BOOKED" ? (
                    <a href={linkFor(item.id)} onClick={(event) => onOpen(event, item.id)} className={ACTION_LINK}>
                      Book a free visit<span className="sr-only"> for {item.outletName}</span>
                    </a>
                  ) : (
                    <a href={linkFor(item.id)} onClick={(event) => onOpen(event, item.id)} className="rounded-md px-2 py-1 font-semibold text-primary hover:underline">
                      Open<span className="sr-only"> {item.outletName}</span>
                    </a>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ───────────────────────── One follow-up ─────────────────────────

type Doing = "book" | "call" | "close" | null;

/**
 * One follow-up beside the list: why it is here and where to see it, the calls logged, the free
 * visit booked, and the three buttons (book, log a call, close with a note), each opening its
 * form in place, one at a time. Booking is open from the start while nothing is booked.
 */
function FollowUpPanel({
  followUp,
  callers,
  types,
  supervisors,
  onChanged,
}: {
  followUp: FollowUpDto;
  callers: FollowUpsDto["callers"];
  types: ServiceTypeDto[];
  supervisors: SupervisorDto[];
  onChanged: (next: FollowUpDto, message: string) => void;
}) {
  const isOpen = followUp.status === "OPEN";
  const canBook = isOpen && followUp.standing === "NOT_BOOKED";
  const [doing, setDoing] = useState<Doing>(canBook ? "book" : null);
  const source = sourceLink(followUp.source);
  const done = (next: FollowUpDto, message: string) => {
    setDoing(null);
    onChanged(next, message);
  };

  const choices: { value: Exclude<Doing, null>; label: string }[] = [
    ...(canBook ? [{ value: "book" as const, label: "Book a free visit" }] : []),
    { value: "call", label: "Log a call" },
    { value: "close", label: "Close with a note" },
  ];

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-lg font-bold">{followUp.outletName}</h2>
          {whereWords(followUp) && <p className="text-sm text-muted">{whereWords(followUp)}</p>}
        </div>
        <StandingBadge standing={followUp.standing} words={followUp.standingWords} />
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-muted">Why it is here</h3>
        <p>{followUp.reason}</p>
        <p className="text-sm text-muted">
          {/* The day only: a score's fall is known by the end of a day, not at a moment. */}
          {shortDay(indiaDay(followUp.causedAt))} · {followUp.sinceDays <= 0 ? "today" : `${plural(followUp.sinceDays, "day")} ago`} ·{" "}
          <Link href={source.href} className="font-semibold text-primary hover:underline">
            {source.label}
          </Link>
        </p>
      </div>

      {followUp.visit && (
        <div className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Free visit: {visitWhenWords(followUp.visit.date, followUp.visit.slot)}</span>
            <StatusBadge status={followUp.visit.status} />
          </p>
          <p className="text-muted">
            {english(followUp.visit.serviceName)} · {followUp.visit.supervisorName ?? "No Supervisor yet"} · no invoice, and no score changes
          </p>
          <Link href={`/visits?visit=${encodeURIComponent(followUp.visit.id)}`} className="w-fit font-semibold text-primary hover:underline">
            Open the visit
          </Link>
        </div>
      )}

      {followUp.status === "CLOSED" && (
        <p className="rounded-lg border border-border p-3 text-sm">
          <span className="font-semibold">
            Closed by {followUp.closedByName ?? "the office"}
            {followUp.closedAt ? ` on ${when(followUp.closedAt)}` : ""}
          </span>
          {followUp.closeNote && <span className="block whitespace-pre-wrap">{followUp.closeNote}</span>}
        </p>
      )}

      {isOpen && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="What to do">
            {choices.map((choice) => (
              <Button
                key={choice.value}
                type="button"
                size="sm"
                variant={doing === choice.value ? "primary" : "secondary"}
                aria-expanded={doing === choice.value}
                onClick={() => setDoing(doing === choice.value ? null : choice.value)}
              >
                {choice.label}
              </Button>
            ))}
          </div>
          {doing === "book" && <BookFreeVisit followUp={followUp} types={types} supervisors={supervisors} onDone={done} onCancel={() => setDoing(null)} />}
          {doing === "call" && <LogCall followUp={followUp} callers={callers} onDone={done} onCancel={() => setDoing(null)} />}
          {doing === "close" && <CloseFollowUp followUp={followUp} onDone={done} onCancel={() => setDoing(null)} />}
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="text-sm font-semibold text-muted">Calls</h3>
        {followUp.calls.length === 0 ? (
          <p className="text-sm text-muted">No call logged yet.</p>
        ) : (
          <ol className="flex flex-col gap-2 text-sm">
            {followUp.calls.map((call) => (
              <li key={call.id}>
                <p className="font-semibold">
                  {call.calledByName} · <span className="font-normal text-muted">{when(call.at)}</span>
                </p>
                <p className="whitespace-pre-wrap">{call.note}</p>
                {call.loggedByName !== call.calledByName && <p className="text-muted">Logged by {call.loggedByName}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}

type FormProps = { followUp: FollowUpDto; onDone: (next: FollowUpDto, message: string) => void; onCancel: () => void };

/** A normal visit in the diary, marked free: no invoice, and its report changes no score (decision 3). */
function BookFreeVisit({ followUp, types, supervisors, onDone, onCancel }: FormProps & { types: ServiceTypeDto[]; supervisors: SupervisorDto[] }) {
  // The rated visit's kind of service, when there is one.
  const [serviceCode, setServiceCode] = useState(followUp.suggestedService ?? "");
  const [date, setDate] = useState(addDays(today(), 1));
  const [slot, setSlot] = useState<VisitSlot>("AFTER_CLOSING");
  const [supervisorId, setSupervisorId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = { serviceCode, date, slot, supervisorId: supervisorId || null };
    const found = checkAgainst(bookFollowUpVisitSchema, input);
    const dateError = checkDate(date, today());
    if (dateError && !found.date) found.date = dateError;
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(event.currentTarget, found);

    setBusy(true);
    setError(null);
    try {
      onDone(await api.quality.bookVisit(followUp.id, input), `Free visit booked for ${visitWhenWords(date, slot)}`);
    } catch (e) {
      setError(describe(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Book a free visit" className="flex flex-col gap-3 rounded-lg border border-primary p-3">
      <SelectField label="Service" name="serviceCode" value={serviceCode} error={errors.serviceCode} onChange={(e) => setServiceCode(e.target.value)}>
        <option value="">Choose a service</option>
        {types.map((type) => (
          <option key={type.code} value={type.code}>
            {english(type.name)}
          </option>
        ))}
      </SelectField>
      <WhenAndWho
        date={date}
        slot={slot}
        supervisorId={supervisorId}
        supervisors={supervisors}
        earliest={today()}
        dateError={errors.date}
        onChange={(next) => {
          if (next.date !== undefined) setDate(next.date);
          if (next.slot !== undefined) setSlot(next.slot);
          if (next.supervisorId !== undefined) setSupervisorId(next.supervisorId);
        }}
      />
      <p className="text-sm font-semibold">Free: no invoice, and no score changes.</p>
      <ErrorMessage message={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy}>
          Book the free visit
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** "Abdul called; a free redo offered": who called, and what was said. */
function LogCall({ followUp, callers, onDone, onCancel }: FormProps & { callers: FollowUpsDto["callers"] }) {
  const { user } = useSession();
  // The person logging it, unless someone else made the call.
  const [calledById, setCalledById] = useState(callers.some((caller) => caller.id === user?.id) ? (user?.id ?? "") : (callers[0]?.id ?? ""));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = { note, ...(calledById && { calledById }) };
    const found = checkAgainst(logFollowUpCallSchema, input);
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(event.currentTarget, found);

    setBusy(true);
    setError(null);
    try {
      onDone(await api.quality.logCall(followUp.id, input), "Call logged");
    } catch (e) {
      setError(describe(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Log a call" className="flex flex-col gap-3 rounded-lg border border-primary p-3">
      <TextAreaField
        label="What was said"
        name="note"
        required
        rows={3}
        autoFocus
        maxLength={QUALITY_RULES.noteMax}
        hint="For example: spoke to the manager; a free redo offered for Friday. The table shows the latest call as what the kitchen was told."
        value={note}
        error={errors.note}
        onChange={(e) => setNote(e.target.value)}
      />
      {callers.length > 0 && (
        <SelectField label="Who called" name="calledById" value={calledById} error={errors.calledById} onChange={(e) => setCalledById(e.target.value)}>
          {callers.map((caller) => (
            <option key={caller.id} value={caller.id}>
              {caller.name}
              {caller.id === user?.id ? " (you)" : ""}
            </option>
          ))}
        </SelectField>
      )}
      <ErrorMessage message={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy}>
          Log the call
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Settled another way: it leaves the queue with the note, kept under Done. */
function CloseFollowUp({ followUp, onDone, onCancel }: FormProps) {
  const confirm = useConfirm();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const found = checkAgainst(closeFollowUpSchema, { note });
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);

    const sure = await confirm({
      title: `Close the follow-up for ${followUp.outletName}?`,
      body: `It leaves the queue and Today, and stays under Done for ${QUALITY_RULES.doneShownDays} days with your note.${followUp.visit && followUp.standing === "BOOKED" ? " The free visit booked stays in the diary; cancel it in Visits if it is not wanted." : ""}`,
      confirmLabel: "Close the follow-up",
      cancelLabel: "Keep it open",
      // Closing loses nothing: the record and its calls are kept.
      tone: "primary",
    });
    if (!sure) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await api.quality.close(followUp.id, { note }), "Follow-up closed");
    } catch (e) {
      setError(describe(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Close with a note" className="flex flex-col gap-3 rounded-lg border border-primary p-3">
      <TextAreaField
        label="How it was settled"
        name="note"
        required
        rows={3}
        autoFocus
        maxLength={QUALITY_RULES.noteMax}
        hint="For example: the manager is happy after the call; no visit wanted."
        value={note}
        error={errors.note}
        onChange={(e) => setNote(e.target.value)}
      />
      <ErrorMessage message={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy}>
          Close the follow-up
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
