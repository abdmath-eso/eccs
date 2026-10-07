"use client";

import {
  can,
  createOrganizationSchema,
  createOutletSchema,
  PLAN_VISITS_DAYS_AHEAD,
  type OrganizationDto,
  type OutletPlanDto,
  type PlanDto,
} from "@eccs/shared";
import { Fragment, useEffect, useState, type FormEvent } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { Button, Card, Code, ErrorMessage, Field, Loading, SelectField } from "@/components/ui";
import { api } from "@/lib/api";
import { checkAgainst, focusFirstError, formValues, hasErrors, type FieldErrors } from "@/lib/forms";
import { addDays, describe, english, longDay, matchesSearch, rupees, shortDay, today } from "@/lib/format";
import { useQuery, useQueryField } from "@/lib/query";
import { useSession } from "@/lib/session";

type Outlet = OrganizationDto["outlets"][number];

/** What to write beside each field so it is typed correctly the first time. */
const HINT = {
  phone: "10 digits. Their one-time code is sent here.",
  gstin: "15 characters, for example 36ABCDE1234F1Z5.",
  pincode: "6 digits.",
};

/** How often a plan is billed, as it reads after the price: "₹15,000 a month". */
const PER_CYCLE: Record<PlanDto["billingCycle"], string> = { MONTHLY: "a month", QUARTERLY: "a quarter", ANNUAL: "a year" };

/** A plan's price as it is quoted to a restaurant, e.g. "₹15,000 a month + GST". */
const planPrice = (plan: PlanDto) => `${rupees(plan.pricePaise)} ${PER_CYCLE[plan.billingCycle]} + GST`;

const everySoOften = (days: number) => (days === 1 ? "every day" : `every ${days} days`);

const visitCount = (count: number) => `${count} visit${count === 1 ? "" : "s"}`;

/**
 * The plan visits of an outlet that are in the diary and not finished, by id.
 * Read before and after a plan is changed, the difference is how many visits
 * were added or cancelled, which the confirmation then says. Null if the list
 * could not be read: the plan was still changed, so the number is simply left out.
 */
const planVisitIds = (outletId: string): Promise<Set<string> | null> =>
  api.visits
    .list({ outletId, state: "open" })
    .then((visits) => new Set(visits.filter((visit) => visit.fromPlan).map((visit) => visit.id)))
    .catch(() => null);

/** How many of `these` are not among `those`; null if either could not be read. */
const countMissingFrom = (these: Set<string> | null, those: Set<string> | null) =>
  these && those ? [...these].filter((id) => !those.has(id)).length : null;

/** Whether the owner has opened the app and been given a PIN, in words. */
function pinStatus(client: OrganizationDto) {
  const set = client.owners.filter((owner) => owner.hasPin).length;
  if (client.owners.length === 0) return { text: "No owner", done: false };
  if (set === client.owners.length) return { text: "Set", done: true };
  return { text: client.owners.length === 1 ? "Not set yet" : `${set} of ${client.owners.length} set`, done: false };
}

/**
 * Clients: every restaurant ECCS serves in one table, with a search, and
 * onboarding. Opening a row shows that client's outlets and restaurant codes.
 *
 * The search (`q=`) and the open row (`client=`) are kept in the web address.
 */
export default function ClientsScreen() {
  const { user } = useSession();
  const query = useQuery();
  const notify = useToast();
  const [search, setSearch] = useQueryField("q");
  const openId = query.get("client");

  const [clients, setClients] = useState<OrganizationDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [onboarding, setOnboarding] = useState(false);
  const [justCreated, setJustCreated] = useState<OrganizationDto | null>(null);

  const mayManage = user ? can(user.memberships, "clients", "create") : false;

  useEffect(() => {
    if (!mayManage) return;
    let cancelled = false;
    api.organizations
      .list()
      .then((list) => {
        if (cancelled) return;
        setClients(list);
        setError(null);
      })
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [mayManage, attempt]);

  if (!mayManage) {
    return (
      <Card>
        <h1 className="text-xl font-bold">Nothing here for your role yet</h1>
        <p className="mt-2 text-muted">
          Client management is for Super Admins and Operations Managers. Supervisors work from the ECCS mobile app.
        </p>
      </Card>
    );
  }

  function added(client: OrganizationDto) {
    setClients((current) => [...(current ?? []), client]);
    setJustCreated(client);
    setOnboarding(false);
    notify(`${client.name} onboarded`);
  }

  function outletAdded(clientId: string, outlet: Outlet) {
    setClients((current) => (current ?? []).map((c) => (c.id === clientId ? { ...c, outlets: [...c.outlets, outlet] } : c)));
    notify(`Outlet added: ${outlet.name}`);
  }

  // Sorted here by name, whatever order the server sent.
  const sorted = [...(clients ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const matching = sorted.filter((client) =>
    matchesSearch(search, [client.name, ...client.outlets.flatMap((outlet) => [outlet.name, outlet.code])]),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Clients</h1>
          <p className="text-muted">Restaurants, their outlets and the codes their staff use to link a phone.</p>
        </div>
        {!onboarding && <Button onClick={() => setOnboarding(true)}>Onboard a restaurant</Button>}
      </div>

      {justCreated && <HandoverCard client={justCreated} onDismiss={() => setJustCreated(null)} />}
      {onboarding && <OnboardForm onCreated={added} onCancel={() => setOnboarding(false)} />}

      {error && (
        <div className="flex flex-col items-start gap-3">
          <ErrorMessage message={error} />
          <Button variant="secondary" onClick={() => setAttempt((current) => current + 1)}>
            Try again
          </Button>
        </div>
      )}
      {clients === null && !error && <Loading />}
      {clients?.length === 0 && <p className="text-muted">No clients yet. Onboard the first restaurant.</p>}

      {clients && clients.length > 0 && (
        <Card className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <Field
              label="Search clients"
              type="search"
              plainLabel
              hint="By client, outlet name or restaurant code."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              wrapperClassName="w-full max-w-md"
            />
            <p role="status" className="text-sm text-muted">
              {search
                ? matching.length === 0
                  ? `No clients match "${search}".`
                  : `Showing ${matching.length} of ${clients.length} clients.`
                : `${clients.length} client${clients.length === 1 ? "" : "s"}.`}
            </p>
          </div>

          {matching.length > 0 && (
            // The side padding keeps the focus ring of the first column from being cut off by the scrolling box.
            <div className="-mx-2 overflow-x-auto px-2">
              <table className="w-full text-left text-sm">
                <thead className="text-muted">
                  <tr className="border-b border-border">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Client
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Owner and phone
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Outlets
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Owner&apos;s PIN
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {matching.map((client) => {
                    const open = client.id === openId;
                    const owner = client.owners[0];
                    const pin = pinStatus(client);
                    // When the search found an outlet or a code rather than the client's name, say which, so the match is not a puzzle.
                    const foundOutlets =
                      search && !matchesSearch(search, [client.name])
                        ? client.outlets.filter((outlet) => matchesSearch(search, [outlet.name, outlet.code]))
                        : [];
                    return (
                      <Fragment key={client.id}>
                        <tr className={open ? "bg-primary/5" : "border-b border-border"}>
                          <th scope="row" className="py-1.5 pr-4 text-left align-top font-normal">
                            <button
                              type="button"
                              aria-expanded={open}
                              aria-controls={`client-${client.id}`}
                              onClick={() => query.set({ client: open ? null : client.id }, "replace")}
                              className="flex cursor-pointer items-baseline gap-2 rounded-md px-2 py-1.5 text-left font-semibold text-primary hover:underline"
                            >
                              <span aria-hidden className="w-3 text-xs">
                                {open ? "▼" : "▶"}
                              </span>
                              {client.name}
                            </button>
                          </th>
                          <td className="py-3 pr-4 align-top">
                            {owner ? (
                              <>
                                {owner.name}
                                <div className="text-muted">{owner.phone ?? "No number"}</div>
                                {client.owners.length > 1 && <div className="text-muted">and {client.owners.length - 1} more</div>}
                              </>
                            ) : (
                              <span className="text-muted">None</span>
                            )}
                          </td>
                          <td className="py-3 pr-4 align-top">
                            {client.outlets.length}
                            {foundOutlets.length > 0 && (
                              <div className="text-muted">Matches {foundOutlets.map((outlet) => `${outlet.name} (${outlet.code})`).join(", ")}</div>
                            )}
                          </td>
                          <td className="py-3 align-top">
                            <span className={pin.done ? "" : "font-semibold text-danger"}>{pin.text}</span>
                          </td>
                        </tr>
                        {open && (
                          <tr id={`client-${client.id}`} className="border-b border-border bg-primary/5">
                            <td colSpan={4} className="px-2 pt-1 pb-4 sm:px-7">
                              <ClientDetail client={client} onOutletAdded={(outlet) => outletAdded(client.id, outlet)} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

/** Shown once after onboarding: exactly what to tell the new owner. */
function HandoverCard({ client, onDismiss }: { client: OrganizationDto; onDismiss: () => void }) {
  const owner = client.owners[0];
  const outlet = client.outlets[0];
  return (
    <Card className="border-primary bg-primary/5">
      <h2 className="text-lg font-bold">{client.name} is set up</h2>
      <p className="mt-1 text-muted">Give the owner these two things:</p>
      <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5">
        <li>
          In the ECCS app, tap <strong>I am the owner</strong> and enter <strong>{owner?.phone}</strong>. A one-time
          code confirms the number and the app shows their PIN.
        </li>
        <li>
          For managers and kitchen staff, the restaurant code for {outlet?.name} is <Code>{outlet?.code}</Code>. Each
          person types it once on their own phone, then logs in with the PIN the owner gives them.
        </li>
      </ol>
      <Button variant="secondary" className="mt-4" onClick={onDismiss}>
        Done
      </Button>
    </Card>
  );
}

function OnboardForm({ onCreated, onCancel }: { onCreated: (client: OrganizationDto) => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formValues(form);
    // The same rules the server applies, checked here first so each mistake is shown beside its own field.
    const found = checkAgainst(createOrganizationSchema, values);
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);

    setBusy(true);
    setError(null);
    try {
      onCreated(
        await api.organizations.create({
          name: values.name ?? "",
          gstin: values.gstin,
          ownerName: values.ownerName ?? "",
          ownerPhone: values.ownerPhone ?? "",
          ownerEmail: values.ownerEmail,
          outletName: values.outletName ?? "",
          outletAddress: values.outletAddress ?? "",
          pincode: values.pincode,
          fssaiNumber: values.fssaiNumber,
        }),
      );
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-bold">Onboard a restaurant</h2>
      <p className="text-sm text-muted">
        Creates the restaurant, its first outlet with a restaurant code, and the owner&apos;s login.
      </p>
      <form onSubmit={submit} noValidate className="mt-4 grid items-start gap-4 sm:grid-cols-2">
        <Field label="Restaurant (brand) name" name="name" required maxLength={120} error={errors.name} />
        <Field label="GSTIN" name="gstin" maxLength={15} autoCapitalize="characters" hint={HINT.gstin} error={errors.gstin} />
        <Field label="Owner's name" name="ownerName" required maxLength={100} error={errors.ownerName} />
        <Field
          label="Owner's mobile number"
          name="ownerPhone"
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          required
          hint={HINT.phone}
          error={errors.ownerPhone}
        />
        <Field label="Owner's email" name="ownerEmail" type="email" autoComplete="off" error={errors.ownerEmail} />
        <span className="hidden sm:block" />
        <Field
          label="First outlet name"
          name="outletName"
          required
          maxLength={120}
          hint="For example: Spice Route, Jubilee Hills"
          error={errors.outletName}
        />
        <Field label="Outlet address" name="outletAddress" required maxLength={300} error={errors.outletAddress} />
        <Field label="PIN code" name="pincode" inputMode="numeric" maxLength={6} hint={HINT.pincode} error={errors.pincode} />
        <Field label="FSSAI licence number" name="fssaiNumber" maxLength={20} error={errors.fssaiNumber} />
        <div className="flex flex-col gap-3 sm:col-span-2">
          <ErrorMessage message={error} />
          <div className="flex gap-3">
            <Button type="submit" loading={busy}>
              Create
            </Button>
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

/** What opens under a client's row: everyone who owns it, its outlets with their codes and plans, and adding an outlet. */
function ClientDetail({ client, onOutletAdded }: { client: OrganizationDto; onOutletAdded: (outlet: Outlet) => void }) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  async function addOutlet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formValues(form);
    const found = checkAgainst(createOutletSchema, values);
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);

    setBusy(true);
    setError(null);
    try {
      onOutletAdded(
        await api.organizations.addOutlet(client.id, {
          outletName: values.outletName ?? "",
          outletAddress: values.outletAddress ?? "",
          pincode: values.pincode,
        }),
      );
      setAdding(false);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-muted">
        {client.owners.map((owner) => (
          <p key={owner.id}>
            Owner: {owner.name} · {owner.phone ?? "no number"}
            {owner.email ? ` · ${owner.email}` : ""} ·{" "}
            {owner.hasPin ? "PIN set" : <span className="font-semibold text-danger">has not set a PIN yet</span>}
          </p>
        ))}
        {client.gstin && <p>GSTIN {client.gstin}</p>}
      </div>

      <table className="w-full text-left">
        <caption className="sr-only">Outlets of {client.name}</caption>
        <thead className="text-muted">
          <tr className="border-b border-border">
            <th scope="col" className="py-2 pr-4 font-medium">
              Outlet
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Address
            </th>
            <th scope="col" className="py-2 font-medium">
              Restaurant code
            </th>
          </tr>
        </thead>
        <tbody>
          {client.outlets.map((outlet) => (
            <Fragment key={outlet.id}>
              <tr>
                <td className="py-2.5 pr-4 font-medium">{outlet.name}</td>
                <td className="py-2.5 pr-4 text-muted">
                  {outlet.address}, {outlet.city}
                </td>
                <td className="py-2.5">
                  <Code>{outlet.code}</Code>
                </td>
              </tr>
              {/* The outlet's plan sits directly under the outlet it belongs to, so the two are read together. */}
              <tr className="border-b border-border last:border-0">
                <td colSpan={3} className="pb-3">
                  <OutletPlan outlet={outlet} />
                </td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>

      {adding ? (
        <form onSubmit={addOutlet} noValidate className="grid items-start gap-4 sm:grid-cols-3">
          <Field label="Outlet name" name="outletName" required maxLength={120} autoFocus error={errors.outletName} />
          <Field label="Address" name="outletAddress" required maxLength={300} error={errors.outletAddress} />
          <Field label="PIN code" name="pincode" inputMode="numeric" maxLength={6} hint={HINT.pincode} error={errors.pincode} />
          <div className="flex flex-col gap-3 sm:col-span-3">
            <ErrorMessage message={error} />
            <div className="flex gap-3">
              <Button type="submit" loading={busy}>
                Add outlet
              </Button>
              <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <div>
          <Button variant="link" className="-ml-2" onClick={() => setAdding(true)}>
            + Add an outlet
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The plan one outlet is on: its name, price and start date, then each service
 * with how often it is done and the date of its next visit. This is how
 * service-agreement tools lay it out (the agreement on the customer's
 * location, its recurring services listed under it with their next date).
 *
 * It is only on the page while its client's row is open, so the plan is
 * fetched then and not for every client when the screen loads.
 */
function OutletPlan({ outlet }: { outlet: Outlet }) {
  const notify = useToast();
  const confirm = useConfirm();
  const [loaded, setLoaded] = useState<OutletPlanDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [choosing, setChoosing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.plans
      .forOutlet(outlet.id)
      .then((found) => {
        if (cancelled) return;
        setLoaded(found);
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
        <ErrorMessage message={`The plan could not be loaded. ${loadError}`} />
        <Button variant="secondary" onClick={() => setAttempt((current) => current + 1)}>
          Try again
        </Button>
      </div>
    );
  }
  if (!loaded) return <Loading className="text-sm">Loading the plan…</Loading>;

  const plan = loaded.plan;

  function saved(next: OutletPlanDto, added: number | null, startDate: string) {
    setLoaded(next);
    setChoosing(false);
    const name = next.plan ? english(next.plan.name) : "new";
    // Visits are only put in the diary a few weeks ahead, so a plan starting later than that adds none yet.
    const startsLater = startDate > addDays(today(), PLAN_VISITS_DAYS_AHEAD);
    const visits =
      added === null
        ? ""
        : added > 0
          ? `; ${visitCount(added)} added to the diary`
          : startsLater
            ? `; its visits go in the diary ${PLAN_VISITS_DAYS_AHEAD} days before they are due`
            : "; no visits added to the diary";
    notify(`${outlet.name} is now on the ${name} plan${visits}`);
  }

  async function stop() {
    if (!plan) return;
    const sure = await confirm({
      title: `Stop the ${english(plan.name)} plan for ${outlet.name}?`,
      body: "Its plan visits that have not started will be cancelled and no new ones will be added. Visits already under way or finished stay on record.",
      confirmLabel: "Stop the plan",
      cancelLabel: "Keep the plan",
    });
    if (!sure) return;

    setStopping(true);
    setError(null);
    try {
      const before = await planVisitIds(outlet.id);
      const next = await api.plans.stop(outlet.id);
      const cancelledCount = countMissingFrom(before, await planVisitIds(outlet.id));
      setLoaded(next);
      notify(`${outlet.name} is no longer on a plan${cancelledCount ? `; ${visitCount(cancelledCount)} cancelled` : ""}`);
    } catch (e) {
      setError(describe(e));
    } finally {
      setStopping(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {plan ? (
          <p>
            <span className="font-semibold">{english(plan.name)} plan</span>
            <span className="text-muted">
              {" "}
              · {planPrice(plan)}
              {loaded.since && ` · ${loaded.since > today() ? "starts" : "since"} ${longDay(loaded.since)}`}
            </span>
          </p>
        ) : (
          <p className="text-muted">No plan</p>
        )}
        {!choosing && (
          <div className="flex flex-wrap gap-x-1">
            <Button variant="link" disabled={stopping} onClick={() => setChoosing(true)}>
              {plan ? "Change plan" : "Put on a plan"}
            </Button>
            {plan && (
              <Button variant="link" loading={stopping} onClick={() => void stop()}>
                Stop the plan
              </Button>
            )}
          </div>
        )}
      </div>

      {/* A failure to stop the plan is shown here, with the outlet it concerns. */}
      <ErrorMessage message={error} />

      {plan && loaded.services.length > 0 && (
        <table className="w-full max-w-2xl text-left">
          <caption className="sr-only">Services in the plan of {outlet.name}</caption>
          <thead className="text-muted">
            <tr>
              <th scope="col" className="py-1 pr-4 font-medium">
                Service
              </th>
              <th scope="col" className="py-1 pr-4 font-medium">
                How often
              </th>
              <th scope="col" className="py-1 font-medium">
                Next visit
              </th>
            </tr>
          </thead>
          <tbody>
            {loaded.services.map((service) => (
              <tr key={service.serviceCode}>
                <td className="py-1 pr-4">{english(service.serviceName)}</td>
                <td className="py-1 pr-4 text-muted">{everySoOften(service.intervalDays)}</td>
                <td className="py-1">{shortDay(service.nextDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {choosing && <PlanForm outlet={outlet} current={plan} onSaved={saved} onCancel={() => setChoosing(false)} />}
    </div>
  );
}

/** Puts an outlet on a plan from a chosen day, or moves it from the plan it is on to another. */
function PlanForm({
  outlet,
  current,
  onSaved,
  onCancel,
}: {
  outlet: Outlet;
  /** The plan the outlet is on now, if any. */
  current: PlanDto | null;
  /** `added` is how many visits went into the diary, or null if that could not be counted. */
  onSaved: (next: OutletPlanDto, added: number | null, startDate: string) => void;
  onCancel: () => void;
}) {
  const [plans, setPlans] = useState<PlanDto[] | null>(null);
  const [planCode, setPlanCode] = useState("");
  const [startDate, setStartDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  // The plans on offer are fetched when the form opens, so a plan added since the page loaded is in the list.
  useEffect(() => {
    let cancelled = false;
    api.plans
      .list()
      .then((list) => !cancelled && setPlans(list))
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const chosen = plans?.find((plan) => plan.code === planCode);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: FieldErrors = {};
    if (!planCode) found.planCode = "Choose a plan.";
    if (!startDate) found.startDate = "Choose a start date.";
    else if (startDate < today()) found.startDate = "Choose today or a later date.";
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(event.currentTarget, found);

    setBusy(true);
    setError(null);
    try {
      const before = await planVisitIds(outlet.id);
      const next = await api.plans.set(outlet.id, { planCode, startDate });
      // Only visits that were not in the diary before are counted, so the old plan's visits never inflate the number.
      const added = countMissingFrom(await planVisitIds(outlet.id), before);
      onSaved(next, added, startDate);
    } catch (e) {
      setError(describe(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-2xl flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h3 className="text-base font-bold">{current ? `Change the plan of ${outlet.name}` : `Put ${outlet.name} on a plan`}</h3>
      {plans === null && !error && <Loading>Loading the plans…</Loading>}
      {plans?.length === 0 && <p className="text-muted">There are no plans to choose from yet.</p>}
      {plans && plans.length > 0 && (
        <>
          <div className="grid items-start gap-3 sm:grid-cols-2">
            <SelectField
              label="Plan"
              name="planCode"
              autoFocus
              value={planCode}
              error={errors.planCode}
              onChange={(e) => setPlanCode(e.target.value)}
            >
              <option value="">Choose a plan</option>
              {plans.map((plan) => (
                <option key={plan.code} value={plan.code}>
                  {english(plan.name)}: {planPrice(plan)}
                  {plan.code === current?.code ? " (the plan now)" : ""}
                </option>
              ))}
            </SelectField>
            <Field
              label="Start date"
              name="startDate"
              type="date"
              required
              min={today()}
              hint="Every service of the plan is first due on this day."
              value={startDate}
              error={errors.startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          {chosen && (
            <p>
              <span className="font-semibold">{english(chosen.name)} includes:</span>{" "}
              {chosen.services.map((service) => `${english(service.serviceName)} ${everySoOften(service.intervalDays)}`).join(", ")}.
            </p>
          )}
          <p className="text-muted">
            {current
              ? `This replaces the ${english(current.name)} plan: its visits that have not started will be cancelled. Visits already under way or finished stay on record.`
              : "Nothing is cancelled: visits already in the diary for this outlet stay as they are."}{" "}
            The new plan&apos;s visits go in the diary by themselves, {PLAN_VISITS_DAYS_AHEAD} days before each is due.
          </p>
        </>
      )}
      <ErrorMessage message={error} />
      <div className="flex flex-wrap gap-2">
        {plans && plans.length > 0 && (
          <Button type="submit" loading={busy}>
            {current ? "Change the plan" : "Put on the plan"}
          </Button>
        )}
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
