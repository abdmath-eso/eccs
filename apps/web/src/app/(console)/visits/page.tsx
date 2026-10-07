"use client";

import { ApiError } from "@eccs/api-client";
import {
  VISIT_SLOTS,
  visitSlotWindow,
  type BookingDto,
  type OrganizationDto,
  type ServiceTypeDto,
  type SupervisorDto,
  type VisitDto,
  type VisitSlot,
  type VisitStatus,
  type VisitSummaryDto,
} from "@eccs/shared";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { Button, Card, ErrorMessage } from "@/components/ui";
import { api } from "@/lib/api";

const clock = (hhmm: string) => {
  const [hours, minutes] = hhmm.split(":").map(Number) as [number, number];
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", hour: "numeric", minute: "2-digit" }).format(
    new Date(Date.UTC(2000, 0, 1, hours, minutes)),
  );
};

/** A two-hour arrival window as people read it, e.g. "10:00 am – 12:00 pm". */
const slotName = (slot: VisitSlot) => {
  const window = visitSlotWindow(slot);
  return window ? `${clock(window.start)} – ${clock(window.end)}` : "After closing";
};

const STATUS: Record<VisitStatus, { label: string; style: string }> = {
  SCHEDULED: { label: "No Supervisor yet", style: "border-danger text-danger" },
  ASSIGNED: { label: "Assigned", style: "border-foreground text-foreground" },
  IN_PROGRESS: { label: "In progress", style: "border-primary text-primary" },
  COMPLETED: { label: "Waiting for sign-off", style: "border-foreground text-foreground" },
  APPROVED: { label: "Signed off", style: "border-primary text-primary" },
  CANCELLED: { label: "Cancelled", style: "border-border text-muted" },
};

const INPUT =
  "rounded-lg border border-border bg-surface px-3 py-2.5 text-base font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

const describe = (error: unknown) =>
  error instanceof ApiError
    ? error.isNetworkError
      ? "Could not reach the server. Is the API running?"
      : error.message
    : "Something went wrong. Try again.";

const day = (isoDate: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));

const rupees = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);

/** Today's date in India, for the earliest day a visit can be put in the diary. */
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

const english = (text: Partial<Record<string, string>>) => text.en ?? Object.values(text)[0] ?? "";

function StatusBadge({ status }: { status: VisitStatus }) {
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS[status].style}`}>
      {STATUS[status].label}
    </span>
  );
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}

/** The day, time of day and Supervisor of a visit: used to confirm a request, add a visit and change one. */
function WhenAndWho({
  date,
  slot,
  supervisorId,
  supervisors,
  onChange,
}: {
  date: string;
  slot: VisitSlot;
  supervisorId: string;
  supervisors: SupervisorDto[];
  onChange: (next: { date?: string; slot?: VisitSlot; supervisorId?: string }) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Labelled label="Date">
        <input type="date" required min={date && date < today() ? date : today()} value={date} onChange={(e) => onChange({ date: e.target.value })} className={INPUT} />
      </Labelled>
      <Labelled label="Arrival time">
        <select value={slot} onChange={(e) => onChange({ slot: e.target.value as VisitSlot })} className={INPUT}>
          {VISIT_SLOTS.map((value) => (
            <option key={value} value={value}>
              {slotName(value)}
            </option>
          ))}
        </select>
      </Labelled>
      <Labelled label="Supervisor">
        <select value={supervisorId} onChange={(e) => onChange({ supervisorId: e.target.value })} className={INPUT}>
          <option value="">Decide later</option>
          {supervisors.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </Labelled>
    </div>
  );
}

/**
 * The service diary. Requests restaurants have sent from the app wait at the
 * top to be confirmed; below them are the visits to come and those done.
 * A Supervisor records each visit in the mobile app, and the restaurant signs it off there.
 */
export default function VisitsPage() {
  const [requests, setRequests] = useState<BookingDto[] | null>(null);
  const [visits, setVisits] = useState<VisitSummaryDto[] | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [supervisors, setSupervisors] = useState<SupervisorDto[]>([]);
  const [selected, setSelected] = useState<VisitDto | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Raised after anything changes, to fetch the lists again. */
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.bookings.list({ requestedOnly: true }), api.visits.list({ state: showClosed ? "closed" : "open" })])
      .then(([waiting, list]) => {
        if (cancelled) return;
        setRequests(waiting);
        setVisits(list);
      })
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [showClosed, version]);

  useEffect(() => {
    // A Supervisor may look at this page but cannot assign visits, so the list stays empty for them.
    api.services
      .supervisors()
      .then(setSupervisors)
      .catch(() => undefined);
  }, []);

  async function open(visitId: string) {
    setError(null);
    setAdding(false);
    try {
      setSelected(await api.visits.get(visitId));
    } catch (e) {
      setError(describe(e));
    }
  }

  /** After anything changes: show the visit as it now is and bring the lists up to date. */
  function changed(visit: VisitDto | null) {
    setSelected(visit);
    setVersion((current) => current + 1);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Visits</h1>
          <p className="text-muted">Confirm what restaurants have asked for, and see every visit in the diary.</p>
        </div>
        <Button
          onClick={() => {
            setSelected(null);
            setAdding(true);
          }}
        >
          Add a visit
        </Button>
      </div>

      <ErrorMessage message={error} />

      {requests && requests.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">Requests waiting for you ({requests.length})</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {requests.map((booking) => (
              <RequestCard key={booking.id} booking={booking} supervisors={supervisors} onDone={() => changed(null)} />
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-bold">{showClosed ? "Signed off and cancelled" : "The diary"}</h2>
        <div className="flex gap-2" role="group" aria-label="Which visits to show">
          <Button variant={showClosed ? "secondary" : "primary"} onClick={() => setShowClosed(false)}>
            To do
          </Button>
          <Button variant={showClosed ? "primary" : "secondary"} onClick={() => setShowClosed(true)}>
            Finished
          </Button>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          {visits === null && !error && <p className="text-muted">Loading…</p>}
          {visits?.length === 0 && <p className="text-muted">{showClosed ? "No finished visits yet." : "Nothing in the diary."}</p>}
          {visits?.map((visit) => (
            <button
              key={visit.id}
              onClick={() => void open(visit.id)}
              className={`cursor-pointer rounded-xl border bg-surface p-4 text-left hover:border-primary ${
                selected?.id === visit.id ? "border-primary ring-2 ring-primary/20" : "border-border"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="font-semibold">{english(visit.serviceName)}</span>
                <StatusBadge status={visit.status} />
              </div>
              <p className="mt-1 text-sm">
                {visit.organizationName} · {visit.outletName}
              </p>
              <p className="mt-2 text-sm text-muted">
                {day(visit.date)}
                {visit.slot ? ` · ${slotName(visit.slot)}` : ""} · {visit.supervisorName ?? "No Supervisor"}
                {visit.booked ? " · Booked by the restaurant" : ""}
                {visit.reportNumber ? ` · ${visit.reportNumber}` : ""}
              </p>
            </button>
          ))}
        </div>

        {adding ? (
          <AddVisit supervisors={supervisors} onDone={(visit) => {
              changed(visit);
              setAdding(false);
            }} onCancel={() => setAdding(false)} />
        ) : selected ? (
          <VisitDetail key={selected.id} visit={selected} supervisors={supervisors} onChanged={changed} />
        ) : (
          <Card className="hidden text-muted lg:block">Select a visit to change it or read its report.</Card>
        )}
      </div>
    </div>
  );
}

function RequestCard({ booking, supervisors, onDone }: { booking: BookingDto; supervisors: SupervisorDto[]; onDone: () => void }) {
  // Offer what the restaurant asked for, unless that day has already gone.
  const [date, setDate] = useState(booking.preferredDate < today() ? today() : booking.preferredDate);
  const [slot, setSlot] = useState<VisitSlot>(booking.preferredSlot ?? "1000");
  const [supervisorId, setSupervisorId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onDone();
    } catch (e) {
      setError(describe(e));
      setBusy(false);
    }
  }

  function confirm(event: FormEvent) {
    event.preventDefault();
    void act(() => api.bookings.confirm(booking.id, { date, slot, supervisorId: supervisorId || null }));
  }

  return (
    <Card>
      <form onSubmit={confirm} className="flex flex-col gap-3">
        <div>
          <h3 className="font-bold">{english(booking.serviceName)}</h3>
          <p className="text-sm">
            {booking.organizationName} · {booking.outletName}
          </p>
          <p className="mt-1 text-sm text-muted">
            Asked for {day(booking.preferredDate)}
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
          onChange={(next) => {
            if (next.date !== undefined) setDate(next.date);
            if (next.slot !== undefined) setSlot(next.slot);
            if (next.supervisorId !== undefined) setSupervisorId(next.supervisorId);
          }}
        />
        <ErrorMessage message={error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy}>
            Confirm the visit
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Turn down this request? The restaurant will see it as cancelled.")) {
                void act(() => api.bookings.cancel(booking.id));
              }
            }}
          >
            Turn down
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AddVisit({
  supervisors,
  onDone,
  onCancel,
}: {
  supervisors: SupervisorDto[];
  onDone: (visit: VisitDto) => void;
  onCancel: () => void;
}) {
  const [clients, setClients] = useState<OrganizationDto[]>([]);
  const [types, setTypes] = useState<ServiceTypeDto[]>([]);
  const [outletId, setOutletId] = useState("");
  const [serviceCode, setServiceCode] = useState("");
  const [date, setDate] = useState(today());
  const [slot, setSlot] = useState<VisitSlot>("AFTER_CLOSING");
  const [supervisorId, setSupervisorId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.organizations.list(), api.services.types()])
      .then(([organizations, serviceTypes]) => {
        setClients(organizations);
        setTypes(serviceTypes);
      })
      .catch((e) => setError(describe(e)));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await api.visits.create({ outletId, serviceCode, date, slot, supervisorId: supervisorId || null }));
    } catch (e) {
      setError(describe(e));
      setBusy(false);
    }
  }

  return (
    <Card className="lg:sticky lg:top-6">
      <form onSubmit={save} className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-bold">Add a visit</h2>
          <p className="text-sm text-muted">For a visit the restaurant did not book in the app, such as one from their plan.</p>
        </div>
        <Labelled label="Outlet">
          <select required value={outletId} onChange={(e) => setOutletId(e.target.value)} className={INPUT}>
            <option value="">Choose an outlet</option>
            {clients.map((client) => (
              <optgroup key={client.id} label={client.name}>
                {client.outlets
                  .filter((outlet) => outlet.isActive)
                  .map((outlet) => (
                    <option key={outlet.id} value={outlet.id}>
                      {outlet.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </Labelled>
        <Labelled label="Service">
          <select required value={serviceCode} onChange={(e) => setServiceCode(e.target.value)} className={INPUT}>
            <option value="">Choose a service</option>
            {types.map((type) => (
              <option key={type.code} value={type.code}>
                {english(type.name)}
              </option>
            ))}
          </select>
        </Labelled>
        <WhenAndWho
          date={date}
          slot={slot}
          supervisorId={supervisorId}
          supervisors={supervisors}
          onChange={(next) => {
            if (next.date !== undefined) setDate(next.date);
            if (next.slot !== undefined) setSlot(next.slot);
            if (next.supervisorId !== undefined) setSupervisorId(next.supervisorId);
          }}
        />
        <ErrorMessage message={error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy}>
            Put it in the diary
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function VisitDetail({
  visit,
  supervisors,
  onChanged,
}: {
  visit: VisitDto;
  supervisors: SupervisorDto[];
  onChanged: (visit: VisitDto) => void;
}) {
  const [date, setDate] = useState(visit.date);
  const [slot, setSlot] = useState<VisitSlot>(visit.slot ?? "1000");
  const [supervisorId, setSupervisorId] = useState(visit.supervisorId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: () => Promise<VisitDto>) {
    setBusy(true);
    setError(null);
    try {
      onChanged(await action());
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    void act(() => api.visits.update(visit.id, { date, slot, supervisorId: supervisorId || null }));
  }

  const photos = (kind: "BEFORE" | "AFTER") => visit.photos.filter((photo) => photo.kind === kind);
  const isReport = visit.status === "COMPLETED" || visit.status === "APPROVED";

  return (
    <Card className="flex flex-col gap-4 lg:sticky lg:top-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{english(visit.serviceName)}</h2>
          <p className="text-sm text-muted">
            {visit.organizationName} · {visit.outletName}
          </p>
          {visit.outletAddress && <p className="text-sm text-muted">{visit.outletAddress}</p>}
        </div>
        <StatusBadge status={visit.status} />
      </div>

      {visit.reportNumber && <p className="font-semibold">Service report {visit.reportNumber}</p>}

      {visit.canManage ? (
        <form onSubmit={save} className="flex flex-col gap-3">
          <WhenAndWho
            date={date}
            slot={slot}
            supervisorId={supervisorId}
            supervisors={supervisors}
            onChange={(next) => {
              if (next.date !== undefined) setDate(next.date);
              if (next.slot !== undefined) setSlot(next.slot);
              if (next.supervisorId !== undefined) setSupervisorId(next.supervisorId);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy}>
              Save changes
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Cancel this visit? If the restaurant booked it, their booking is cancelled too.")) {
                  void act(() => api.visits.cancel(visit.id));
                }
              }}
            >
              Cancel the visit
            </Button>
          </div>
          <p className="text-sm text-muted">The Supervisor checks in and records the work in the mobile app, under My visits.</p>
        </form>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">When</dt>
          <dd>
            {day(visit.date)}
            {visit.slot ? ` · ${slotName(visit.slot)}` : ""}
          </dd>
          <dt className="text-muted">Supervisor</dt>
          <dd>{visit.supervisorName ?? "Not assigned"}</dd>
          {visit.checkInAt && (
            <>
              <dt className="text-muted">Arrived</dt>
              <dd>{when(visit.checkInAt)}</dd>
            </>
          )}
          {visit.completedAt && (
            <>
              <dt className="text-muted">Finished</dt>
              <dd>{when(visit.completedAt)}</dd>
            </>
          )}
          {visit.technicianNames.length > 0 && (
            <>
              <dt className="text-muted">Team</dt>
              <dd>{visit.technicianNames.join(", ")}</dd>
            </>
          )}
        </dl>
      )}

      <ErrorMessage message={error} />

      {visit.tasks.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-muted">Tasks</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {visit.tasks.map((task) => (
              <li key={task.itemId} className="flex gap-2">
                <span className={task.done === null ? "text-muted" : task.done ? "text-primary" : "text-danger"} aria-hidden>
                  {task.done === null ? "○" : task.done ? "✓" : "✗"}
                </span>
                <span>
                  {english(task.label)}
                  {task.done === false && <span className="text-danger"> · Not done{task.note ? `: ${task.note}` : ""}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(["BEFORE", "AFTER"] as const).map(
        (kind) =>
          photos(kind).length > 0 && (
            <div key={kind} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-muted">{kind === "BEFORE" ? "Before the work" : "After the work"}</h3>
              <div className="grid grid-cols-2 gap-2">
                {photos(kind).map((photo) => (
                  <a key={photo.id} href={api.fileUrl(photo.path)} target="_blank" rel="noreferrer">
                    {/* Photos come from the API through short-lived signed links, so the image optimiser is not used. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={api.fileUrl(photo.path)} alt={kind === "BEFORE" ? "Before the work" : "After the work"} className="h-40 w-full rounded-lg object-cover" />
                  </a>
                ))}
              </div>
            </div>
          ),
      )}

      {visit.notes && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-muted">Notes for the restaurant</h3>
          <p className="text-sm whitespace-pre-wrap">{visit.notes}</p>
        </div>
      )}

      {isReport && (
        <p className={`rounded-lg border p-3 text-sm ${visit.signOff ? "border-primary text-primary" : "border-border text-muted"}`}>
          {visit.signOff
            ? `Signed off by ${visit.signOff.name} on ${when(visit.signOff.signedAt)}`
            : "Waiting for the restaurant's Owner or Manager to sign off in the app."}
        </p>
      )}
    </Card>
  );
}
