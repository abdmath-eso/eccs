"use client";

import {
  isVisitAhead,
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
import { useEffect, useState, type FormEvent } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { MasterDetail } from "@/components/master-detail";
import { useToast } from "@/components/toast";
import { Button, Card, ErrorMessage, Field, Loading, SelectField, ToggleGroup } from "@/components/ui";
import { api } from "@/lib/api";
import { focusFirstError, hasErrors, type FieldErrors } from "@/lib/forms";
import { addDays, describe, shortDay, today, when } from "@/lib/format";
import { useNavCounts } from "@/lib/nav-counts";
import { isPlainClick, useQuery, useQueryField } from "@/lib/query";

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
  CANCELLED: { label: "Cancelled", style: "border-border-strong text-muted" },
};

const rupees = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);

const english = (text: Partial<Record<string, string>>) => text.en ?? Object.values(text)[0] ?? "";

/** The quick filters over the diary. They are kept in the web address as `show=`. */
const SHOW = ["all", "unassigned", "overdue", "today"] as const;
type Show = (typeof SHOW)[number];

/** Before today and the work has not been done. */
const isOverdue = (visit: VisitSummaryDto, todayIso: string) => visit.date < todayIso && isVisitAhead(visit.status);

const hasNoSupervisor = (visit: VisitSummaryDto) => visit.supervisorId === null;

/** Earlier windows first; a visit with no time comes last in its day. */
const slotOrder = (slot: VisitSlot | null) => (slot ? VISIT_SLOTS.indexOf(slot) : VISIT_SLOTS.length);

interface DayGroup {
  key: string;
  title: string;
  /** Rows under "Overdue" come from several days, so each says its own date. */
  showDate: boolean;
  visits: VisitSummaryDto[];
}

/**
 * Puts visits under day headings. The diary runs forwards from today with
 * anything overdue pinned above it; finished visits run backwards from the
 * most recent. The order is worked out here, whatever order the server sent.
 */
function groupByDay(visits: VisitSummaryDto[], closed: boolean, todayIso: string): DayGroup[] {
  const sorted = [...visits].sort(
    (a, b) =>
      (closed ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)) ||
      slotOrder(a.slot) - slotOrder(b.slot) ||
      a.organizationName.localeCompare(b.organizationName) ||
      a.outletName.localeCompare(b.outletName),
  );
  const tomorrowIso = addDays(todayIso, 1);
  const overdue: DayGroup = { key: "overdue", title: "Overdue", showDate: true, visits: [] };
  const days: DayGroup[] = [];

  for (const visit of sorted) {
    if (!closed && isOverdue(visit, todayIso)) {
      overdue.visits.push(visit);
      continue;
    }
    let group = days[days.length - 1];
    if (!group || group.key !== visit.date) {
      const name = shortDay(visit.date);
      const title = visit.date === todayIso ? `Today, ${name}` : visit.date === tomorrowIso ? `Tomorrow, ${name}` : name;
      group = { key: visit.date, title, showDate: false, visits: [] };
      days.push(group);
    }
    group.visits.push(visit);
  }
  return overdue.visits.length > 0 ? [overdue, ...days] : days;
}

function StatusBadge({ status }: { status: VisitStatus }) {
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS[status].style}`}>
      {STATUS[status].label}
    </span>
  );
}

/** A visit cannot be put on a day that has gone, except that one already overdue may keep its day. */
function checkDate(date: string, earliest: string): string | undefined {
  if (!date) return "Choose a date.";
  if (date < earliest) return "Choose today or a later date.";
  return undefined;
}

/** The day, time of day and Supervisor of a visit: used to confirm a request, add a visit and change one. */
function WhenAndWho({
  date,
  slot,
  supervisorId,
  supervisors,
  earliest,
  dateError,
  onChange,
}: {
  date: string;
  slot: VisitSlot;
  supervisorId: string;
  supervisors: SupervisorDto[];
  /** The first day the calendar offers. */
  earliest: string;
  dateError?: string;
  onChange: (next: { date?: string; slot?: VisitSlot; supervisorId?: string }) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Date" name="date" type="date" required min={earliest} value={date} error={dateError} onChange={(e) => onChange({ date: e.target.value })} />
      <SelectField label="Arrival time" name="slot" value={slot} onChange={(e) => onChange({ slot: e.target.value as VisitSlot })}>
        {VISIT_SLOTS.map((value) => (
          <option key={value} value={value}>
            {slotName(value)}
          </option>
        ))}
      </SelectField>
      <SelectField label="Supervisor" name="supervisorId" value={supervisorId} onChange={(e) => onChange({ supervisorId: e.target.value })}>
        <option value="">Decide later</option>
        {supervisors.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </SelectField>
    </div>
  );
}

/**
 * The service diary. Requests restaurants have sent from the app wait at the
 * top to be confirmed; below them are the visits to come and those done.
 * A Supervisor records each visit in the mobile app, and the restaurant signs it off there.
 *
 * What is being looked at lives in the web address: `state=closed` for the
 * finished visits, `show=` and `supervisor=` for the filters, `visit=` for the
 * visit that is open and `new=1` while one is being added.
 */
export default function VisitsScreen() {
  const query = useQuery();
  const notify = useToast();
  const { refresh: refreshCounts } = useNavCounts();

  const closed = query.get("state") === "closed";
  const asked = query.get("show") as Show;
  // "No Supervisor" and "Overdue" only make sense for visits still to be done.
  const show: Show = !closed && SHOW.includes(asked) ? asked : "all";
  const [supervisorFilter, setSupervisorFilter] = useQueryField("supervisor");
  const visitId = query.get("visit");
  const adding = query.get("new") === "1";

  const [requests, setRequests] = useState<BookingDto[] | null>(null);
  // Kept with the list it belongs to, so switching between "To do" and "Finished" never shows the other one's visits.
  const [loaded, setLoaded] = useState<{ closed: boolean; list: VisitSummaryDto[] } | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [supervisors, setSupervisors] = useState<SupervisorDto[]>([]);
  const [detail, setDetail] = useState<VisitDto | null>(null);
  const [detailError, setDetailError] = useState<{ id: string; message: string } | null>(null);

  /** Raised after anything changes, or to try again, to fetch the lists again. */
  const [version, setVersion] = useState(0);
  const [detailAttempt, setDetailAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.bookings.list({ requestedOnly: true }), api.visits.list({ state: closed ? "closed" : "open" })])
      .then(([waiting, list]) => {
        if (cancelled) return;
        setRequests(waiting);
        setLoaded({ closed, list });
        setListError(null);
      })
      .catch((e) => !cancelled && setListError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [closed, version]);

  useEffect(() => {
    // A Supervisor may look at this page but cannot assign visits, so the list stays empty for them.
    api.services
      .supervisors()
      .then(setSupervisors)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!visitId) return;
    let cancelled = false;
    api.visits
      .get(visitId)
      .then((visit) => !cancelled && setDetail(visit))
      .catch((e) => !cancelled && setDetailError({ id: visitId, message: describe(e) }));
    return () => {
      cancelled = true;
    };
  }, [visitId, detailAttempt]);

  /** After anything changes: say so briefly, and bring the lists and the counts in the menu up to date. */
  function changed(message: string, visit?: VisitDto) {
    if (visit) setDetail(visit);
    setVersion((current) => current + 1);
    refreshCounts();
    notify(message);
  }

  const todayIso = today();
  const visits = loaded && loaded.closed === closed ? loaded.list : null;
  const openVisit = detail && detail.id === visitId ? detail : null;
  const openError = detailError && detailError.id === visitId ? detailError.message : null;

  // The Supervisor list is only sent to admins, so names already on visits are added to it for the filter.
  const people = new Map(supervisors.map((person) => [person.id, person.name]));
  for (const visit of visits ?? []) {
    if (visit.supervisorId && visit.supervisorName) people.set(visit.supervisorId, visit.supervisorName);
  }
  const supervisorOptions = [...people].sort((a, b) => a[1].localeCompare(b[1]));

  const ofSupervisor = (visits ?? []).filter((visit) => !supervisorFilter || visit.supervisorId === supervisorFilter);
  const matching: Record<Show, VisitSummaryDto[]> = {
    all: ofSupervisor,
    unassigned: ofSupervisor.filter(hasNoSupervisor),
    overdue: ofSupervisor.filter((visit) => isOverdue(visit, todayIso)),
    today: ofSupervisor.filter((visit) => visit.date === todayIso),
  };
  const groups = groupByDay(matching[show], closed, todayIso);
  const filtered = show !== "all" || supervisorFilter !== "";

  const detailOpen = adding || visitId !== "";
  // On a narrow screen an open visit takes the place of everything above the list as well as the list.
  const besideDetail = detailOpen ? "hidden lg:flex" : "flex";

  const detailPanel = adding ? (
    <AddVisit
      supervisors={supervisors}
      onDone={(visit) => {
        query.set({ new: null, visit: visit.id }, "replace");
        changed(`Visit added for ${shortDay(visit.date)}`, visit);
      }}
      onCancel={() => query.set({ new: null }, "replace")}
    />
  ) : openVisit ? (
    <VisitDetail key={openVisit.id} visit={openVisit} supervisors={supervisors} onChanged={(visit, message) => changed(message, visit)} />
  ) : openError ? (
    <Card className="flex flex-col items-start gap-3">
      <ErrorMessage message={openError} />
      <Button
        variant="secondary"
        onClick={() => {
          setDetailError(null);
          setDetailAttempt((current) => current + 1);
        }}
      >
        Try again
      </Button>
    </Card>
  ) : visitId ? (
    <Card>
      <Loading>Opening the visit…</Loading>
    </Card>
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Visits</h1>
          <p className="text-muted">Confirm what restaurants have asked for, and see every visit in the diary.</p>
        </div>
        {!adding && <Button onClick={() => query.set({ new: "1", visit: null })}>Add a visit</Button>}
      </div>

      {requests && requests.length > 0 && (
        <section className={`${besideDetail} flex-col gap-3`}>
          <h2 className="text-lg font-bold">Requests waiting for you ({requests.length})</h2>
          <div className="grid gap-3 xl:grid-cols-2">
            {requests.map((booking) => (
              <RequestCard key={booking.id} booking={booking} supervisors={supervisors} onDone={(message) => changed(message)} />
            ))}
          </div>
        </section>
      )}

      <div className={`${besideDetail} flex-col gap-4`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-lg font-bold">{closed ? "Signed off and cancelled" : "The diary"}</h2>
          <ToggleGroup
            label="Which visits to show"
            value={closed ? "closed" : "open"}
            options={[
              { value: "open", label: "To do" },
              { value: "closed", label: "Finished" },
            ]}
            onChange={(value) => query.set({ state: value === "closed" ? "closed" : null, show: null }, "replace")}
          />
        </div>

        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          {!closed && (
            <ToggleGroup
              label="Filter the diary"
              value={show}
              options={[
                { value: "all", label: "All", count: matching.all.length },
                { value: "unassigned", label: "No Supervisor", count: matching.unassigned.length },
                { value: "overdue", label: "Overdue", count: matching.overdue.length },
                { value: "today", label: "Today", count: matching.today.length },
              ]}
              onChange={(value) => query.set({ show: value === "all" ? null : value }, "replace")}
            />
          )}
          {supervisorOptions.length > 0 && (
            <SelectField
              label="Supervisor"
              value={supervisorFilter}
              onChange={(e) => setSupervisorFilter(e.target.value)}
              wrapperClassName="min-w-52"
            >
              <option value="">All Supervisors</option>
              {supervisorOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </SelectField>
          )}
        </div>
      </div>

      <MasterDetail
        detail={detailPanel}
        detailLabel={adding ? "Add a visit" : "Visit details"}
        placeholder="Select a visit to change it or read its report."
        backHref={query.hrefWith({ visit: null, new: null })}
        onBack={() => query.set({ visit: null, new: null })}
        list={
          <>
            {listError && (
              <div className="flex flex-col items-start gap-3">
                <ErrorMessage message={listError} />
                <Button variant="secondary" onClick={() => setVersion((current) => current + 1)}>
                  Try again
                </Button>
              </div>
            )}
            {visits === null && !listError && <Loading />}
            {visits?.length === 0 && <p className="text-muted">{closed ? "No finished visits yet." : "Nothing in the diary."}</p>}
            {visits && visits.length > 0 && filtered && (
              <div className="flex flex-wrap items-center gap-x-2">
                <p role="status" className="text-sm text-muted">
                  {matching[show].length === 0 ? "No visits match these filters." : `Showing ${matching[show].length} of ${visits.length} visits.`}
                </p>
                <Button
                  variant="link"
                  className="text-sm"
                  onClick={() => {
                    setSupervisorFilter("");
                    query.set({ show: null }, "replace");
                  }}
                >
                  Show all visits
                </Button>
              </div>
            )}
            {groups.map((group) => (
              <section key={group.key} aria-labelledby={`day-${group.key}`} className="flex flex-col gap-2">
                <h3 id={`day-${group.key}`} className={`text-sm font-bold ${group.key === "overdue" ? "text-danger" : ""}`}>
                  {group.title} <span className="font-normal text-muted">({group.visits.length})</span>
                </h3>
                <ul className="flex flex-col gap-2">
                  {group.visits.map((visit) => {
                    const selected = visit.id === visitId;
                    const opening = selected && !openVisit && !openError;
                    return (
                      <li key={visit.id}>
                        <a
                          href={query.hrefWith({ visit: visit.id, new: null })}
                          onClick={(event) => {
                            if (!isPlainClick(event)) return;
                            event.preventDefault();
                            if (!selected) query.set({ visit: visit.id, new: null });
                          }}
                          aria-current={selected ? "true" : undefined}
                          aria-busy={opening || undefined}
                          className={`block rounded-xl border bg-surface p-4 hover:border-primary ${
                            selected ? "border-primary ring-2 ring-primary" : "border-border"
                          }`}
                        >
                          <span className="flex items-start justify-between gap-3">
                            <span className="font-semibold">{english(visit.serviceName)}</span>
                            <StatusBadge status={visit.status} />
                          </span>
                          <span className="mt-1 block text-sm">
                            {visit.organizationName} · {visit.outletName}
                          </span>
                          <span className="mt-2 block text-sm text-muted">
                            {group.showDate ? `${shortDay(visit.date)} · ` : ""}
                            {visit.slot ? `${slotName(visit.slot)} · ` : ""}
                            {visit.supervisorName ?? "No Supervisor"}
                            {visit.booked ? " · Booked by the restaurant" : ""}
                            {visit.reportNumber ? ` · ${visit.reportNumber}` : ""}
                          </span>
                          {opening && (
                            <span role="status" className="mt-2 block text-sm font-semibold text-primary">
                              Opening…
                            </span>
                          )}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </>
        }
      />
    </div>
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
    void act(() => api.bookings.confirm(booking.id, { date, slot, supervisorId: supervisorId || null }), `Visit confirmed for ${shortDay(date)}`);
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
            Confirm the visit
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void turnDown()}>
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
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    Promise.all([api.organizations.list(), api.services.types()])
      .then(([organizations, serviceTypes]) => {
        setClients(organizations);
        setTypes(serviceTypes);
      })
      .catch((e) => setError(describe(e)));
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: FieldErrors = {};
    if (!outletId) found.outletId = "Choose an outlet.";
    if (!serviceCode) found.serviceCode = "Choose a service.";
    const dateError = checkDate(date, today());
    if (dateError) found.date = dateError;
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(event.currentTarget, found);

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
    <Card>
      <form onSubmit={save} noValidate className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-bold">Add a visit</h2>
          <p className="text-sm text-muted">For a visit the restaurant did not book in the app, such as one from their plan.</p>
        </div>
        <SelectField label="Outlet" name="outletId" value={outletId} error={errors.outletId} onChange={(e) => setOutletId(e.target.value)}>
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
        </SelectField>
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

/** What changed, in a few words, for the confirmation shown after saving. */
function describeChange(before: VisitDto, after: VisitDto) {
  if (after.date !== before.date) return `Visit moved to ${shortDay(after.date)}`;
  if (after.supervisorId !== before.supervisorId) {
    return after.supervisorName ? `Visit given to ${after.supervisorName}` : "Supervisor taken off the visit";
  }
  if (after.slot && after.slot !== before.slot) return `Arrival time changed to ${slotName(after.slot).toLowerCase()}`;
  return "Visit saved";
}

function VisitDetail({
  visit,
  supervisors,
  onChanged,
}: {
  visit: VisitDto;
  supervisors: SupervisorDto[];
  onChanged: (visit: VisitDto, message: string) => void;
}) {
  const confirm = useConfirm();
  const [date, setDate] = useState(visit.date);
  const [slot, setSlot] = useState<VisitSlot>(visit.slot ?? "1000");
  const [supervisorId, setSupervisorId] = useState(visit.supervisorId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  // A visit that is already overdue may keep its day while something else about it is changed.
  const earliest = visit.date < today() ? visit.date : today();

  async function act(action: () => Promise<VisitDto>, message: (saved: VisitDto) => string) {
    setBusy(true);
    setError(null);
    try {
      const saved = await action();
      onChanged(saved, message(saved));
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const dateError = checkDate(date, earliest);
    const found: FieldErrors = dateError ? { date: dateError } : {};
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(event.currentTarget, found);
    void act(
      () => api.visits.update(visit.id, { date, slot, supervisorId: supervisorId || null }),
      (saved) => describeChange(visit, saved),
    );
  }

  async function cancelVisit() {
    const sure = await confirm({
      title: "Cancel this visit?",
      body: `${english(visit.serviceName)} at ${visit.outletName} on ${shortDay(visit.date)} will be taken out of the diary. If the restaurant booked it, their booking is cancelled too.`,
      confirmLabel: "Cancel the visit",
      cancelLabel: "Keep the visit",
    });
    if (sure) void act(() => api.visits.cancel(visit.id), () => "Visit cancelled");
  }

  const photos = (kind: "BEFORE" | "AFTER") => visit.photos.filter((photo) => photo.kind === kind);
  const isReport = visit.status === "COMPLETED" || visit.status === "APPROVED";

  return (
    <Card className="flex flex-col gap-4">
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
        <form onSubmit={save} noValidate className="flex flex-col gap-3">
          <WhenAndWho
            date={date}
            slot={slot}
            supervisorId={supervisorId}
            supervisors={supervisors}
            earliest={earliest}
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
              Save changes
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void cancelVisit()}>
              Cancel the visit
            </Button>
          </div>
          <p className="text-sm text-muted">The Supervisor checks in and records the work in the mobile app, under My visits.</p>
        </form>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">When</dt>
          <dd>
            {shortDay(visit.date)}
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
                  {/* The marks are pictures only, so the same thing is said in words for a screen reader. "Not done" is already written out below. */}
                  {task.done !== false && <span className="sr-only">{task.done ? "Done: " : "Not recorded: "}</span>}
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
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
