"use client";

// Visits → Waiting (20 Oct 2026): the services restaurants have booked in the app that have
// no date yet, each placed with the date, arrival time and Supervisor, or turned down.
// Pattern followed: Jobber's "unscheduled" list beside the schedule and ServiceTitan's job
// tray: one queue of work waiting for a slot, each item leaving it once placed.

import { type BookingDto, type SupervisorDto, type VisitSlot } from "@eccs/shared";
import { useState, type FormEvent } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { Button, Card, EmptyState, ErrorMessage, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { focusFirstError, hasErrors, type FieldErrors } from "@/lib/forms";
import { describe, english, rupees, shortDay, today, when } from "@/lib/format";

import { checkDate, slotName, WhenAndWho } from "./visit-parts";

export function WaitingRequests({
  requests,
  supervisors,
  onDone,
}: {
  requests: BookingDto[] | null;
  supervisors: SupervisorDto[];
  onDone: (message: string) => void;
}) {
  if (requests === null) return <Loading />;
  if (requests.length === 0) {
    return (
      <EmptyState title="Nothing waiting for a slot">
        A service a restaurant books in the app waits here until it is given a date. The restaurant sees &ldquo;date to be confirmed&rdquo; until then.
      </EmptyState>
    );
  }
  return (
    <section aria-labelledby="waiting-title" className="flex flex-col gap-3">
      <h2 id="waiting-title" className="text-lg font-bold">
        Booked in the app, not yet placed ({requests.length})
      </h2>
      <div className="grid gap-3 xl:grid-cols-2">
        {requests.map((booking) => (
          <RequestCard key={booking.id} booking={booking} supervisors={supervisors} onDone={onDone} />
        ))}
      </div>
    </section>
  );
}

function RequestCard({ booking, supervisors, onDone }: { booking: BookingDto; supervisors: SupervisorDto[]; onDone: (message: string) => void }) {
  const confirm = useConfirm();
  // Offer what the restaurant asked for, unless that day has already gone.
  const [date, setDate] = useState(booking.preferredDate < today() ? today() : booking.preferredDate);
  const [slot, setSlot] = useState<VisitSlot>(booking.preferredSlot ?? "1000");
  const [supervisorId, setSupervisorId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  async function act(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onDone(message);
    } catch (e) {
      setError(describe(e));
      setBusy(false);
    }
  }

  function confirmVisit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const dateError = checkDate(date, today());
    const found: FieldErrors = dateError ? { date: dateError } : {};
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(event.currentTarget, found);
    void act(() => api.bookings.confirm(booking.id, { date, slot, supervisorId: supervisorId || null }), `Visit placed on ${shortDay(date)}`);
  }

  async function turnDown() {
    const sure = await confirm({
      title: "Turn down this request?",
      body: `${booking.organizationName} will see their request for ${english(booking.serviceName)} as cancelled.`,
      confirmLabel: "Turn down the request",
      cancelLabel: "Keep the request",
    });
    if (sure) void act(() => api.bookings.cancel(booking.id), "Request turned down");
  }

  return (
    <Card>
      <form onSubmit={confirmVisit} noValidate className="flex flex-col gap-3">
        <div>
          <h3 className="font-bold">{english(booking.serviceName)}</h3>
          <p className="text-sm">
            {booking.organizationName} · {booking.outletName}
          </p>
          <p className="mt-1 text-sm text-muted">
            Asked for {shortDay(booking.preferredDate)}
            {booking.preferredSlot ? `, ${slotName(booking.preferredSlot).toLowerCase()}` : ""} · {rupees(booking.pricePaise)} + GST ·{" "}
            {booking.requestedByName}, {when(booking.createdAt)}
          </p>
          {booking.notes && <p className="mt-2 rounded-lg bg-background p-2 text-sm whitespace-pre-wrap">{booking.notes}</p>}
        </div>
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
        <ErrorMessage message={error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy}>
            Place the visit
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void turnDown()}>
            Turn down
          </Button>
        </div>
      </form>
    </Card>
  );
}
