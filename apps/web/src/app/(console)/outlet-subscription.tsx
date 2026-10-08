"use client";

import {
  PLAN_VISITS_DAYS_AHEAD,
  type BillingCycle,
  type OrganizationDto,
  type OutletSubscriptionDto,
  type PlanOfferDto,
  type SubscriptionDto,
} from "@eccs/shared";
import { useEffect, useState, type FormEvent } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { Button, ErrorMessage, Field, Loading, SelectField } from "@/components/ui";
import { api } from "@/lib/api";
import { focusFirstError, hasErrors, type FieldErrors } from "@/lib/forms";
import { describe, english, longDay, rupees, shortDay, today } from "@/lib/format";

import { Tag } from "./client-editing";

type Outlet = OrganizationDto["outlets"][number];

/** How often a plan is billed, as it reads after the price: "₹15,000 a month". */
const PER_CYCLE: Record<BillingCycle, string> = { MONTHLY: "a month", QUARTERLY: "a quarter", ANNUAL: "a year" };

/** A price as ECCS quotes it and as the restaurant pays it: "₹6,000 a month + GST (₹7,080 with GST)". */
const quoted = (price: { pricePaise: number; totalPaise: number; billingCycle: BillingCycle }) =>
  `${rupees(price.pricePaise)} ${PER_CYCLE[price.billingCycle]} + GST (${rupees(price.totalPaise)} with GST)`;

const everySoOften = (days: number) => (days === 1 ? "every day" : `every ${days} days`);
const visitCount = (count: number) => `${count} visit${count === 1 ? "" : "s"}`;

/**
 * The plan visits of an outlet that are in the diary and not finished, by id.
 * Read before and after a change, the difference is how many visits were
 * added or cancelled, which the confirmation then says. Null if the list could
 * not be read: the change was still made, so the number is simply left out.
 */
const planVisitIds = (outletId: string): Promise<Set<string> | null> =>
  api.visits
    .list({ outletId, state: "open" })
    .then((visits) => new Set(visits.filter((visit) => visit.fromPlan).map((visit) => visit.id)))
    .catch(() => null);

/** How many of `these` are not among `those`; null if either could not be read. */
const countMissingFrom = (these: Set<string> | null, those: Set<string> | null) =>
  these && those ? [...these].filter((id) => !those.has(id)).length : null;

/** Where the subscription stands, in a few words. Each state has its own wording, never colour alone. */
function stateOf(subscription: SubscriptionDto): string {
  if (subscription.status === "PAUSED") return `Paused${subscription.pausedOn ? ` since ${longDay(subscription.pausedOn)}` : ""}`;
  if (subscription.endsOn) return `Ending on ${longDay(subscription.endsOn)}`;
  if (subscription.pendingPlan && subscription.renewal) {
    return `Changing to ${english(subscription.pendingPlan.name)} on ${longDay(subscription.renewal.date)}`;
  }
  return subscription.currentPeriodStart > today() ? `Starts on ${longDay(subscription.currentPeriodStart)}` : "Active";
}

/**
 * One outlet's subscription, on its client's row: the plan, what it includes
 * and when each service is next due, the price, the cycle now running, the
 * next invoice, and where it stands. Under it, what ECCS can do: start,
 * change plan, pause and resume, cancel at the end of the cycle, cancel now.
 *
 * Laid out as billing tools show a customer's subscription (Stripe's and
 * Chargebee's subscription pages): the state beside the name, the current
 * period and the next invoice as plain facts, a scheduled change or
 * cancellation stated with its date and an undo beside it, and every action
 * that ends or interrupts something confirmed first with exactly what happens.
 *
 * It is only on the page while its client's row is open, so it is fetched
 * then and not for every client when the screen loads.
 */
export function OutletSubscription({ outlet }: { outlet: Outlet }) {
  const notify = useToast();
  const confirm = useConfirm();
  const [loaded, setLoaded] = useState<OutletSubscriptionDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [form, setForm] = useState<"start" | "change" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.subscriptions
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

  const subscription = loaded.subscription;
  const planName = subscription ? english(subscription.plan.name) : "";

  /** Makes one change and puts the answer on the page. `done` words the confirmation from the answer. */
  async function act(action: () => Promise<OutletSubscriptionDto>, done: (next: OutletSubscriptionDto) => string) {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      setLoaded(next);
      notify(done(next));
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  async function pause() {
    if (!subscription) return;
    const sure = await confirm({
      title: `Pause the ${planName} plan for ${outlet.name}?`,
      body: `While it is paused no new visits are added to the diary, it is not renewed and no new invoice is raised. Visits already in the diary stay: cancel in Visits any that should not happen. The cycle already invoiced still ends on ${longDay(subscription.currentPeriodEnd)}; days paused are not added to it. If you resume after that date, a new cycle starts on the day you resume.`,
      confirmLabel: "Pause the plan",
      cancelLabel: "Keep it running",
    });
    if (sure) await act(() => api.subscriptions.pause(outlet.id), () => `${outlet.name}: the ${planName} plan is paused`);
  }

  async function resume() {
    if (!subscription) return;
    const ranOut = subscription.currentPeriodEnd < today();
    const sure = await confirm({
      title: `Resume the ${planName} plan for ${outlet.name}?`,
      body: ranOut
        ? `Its last cycle ended on ${longDay(subscription.currentPeriodEnd)}, so a new cycle starts today and an invoice is raised for it. Visits go in the diary again from the next one due.`
        : `It carries on in the cycle it was paused in, which ends on ${longDay(subscription.currentPeriodEnd)}, and renews after that. Visits go in the diary again from the next one due; those missed while paused are not made up.`,
      confirmLabel: "Resume the plan",
      cancelLabel: "Leave it paused",
    });
    if (sure) await act(() => api.subscriptions.resume(outlet.id), () => `${outlet.name}: the ${planName} plan is running again`);
  }

  async function cancelAtEnd() {
    if (!subscription) return;
    const last = longDay(subscription.currentPeriodEnd);
    const sure = await confirm({
      title: `Cancel the ${planName} plan for ${outlet.name} at the end of its cycle?`,
      body: `Nothing changes until ${last}: its visits up to that day go ahead. It is then not renewed, no further invoice is raised, and its visits after that day that have not started are cancelled.${
        subscription.pendingPlan ? ` The change to ${english(subscription.pendingPlan.name)} is dropped.` : ""
      } You or the Owner can undo this until ${last}.`,
      confirmLabel: "Cancel at the end of the cycle",
      cancelLabel: "Keep the plan",
    });
    if (!sure) return;
    await act(
      () => api.subscriptions.cancel(outlet.id, "PERIOD_END"),
      (next) => (next.subscription ? `${outlet.name}: the ${planName} plan ends on ${last}` : `${outlet.name} is no longer on a plan`),
    );
  }

  async function cancelNow() {
    if (!subscription) return;
    const sure = await confirm({
      title: `Cancel the ${planName} plan for ${outlet.name} now?`,
      body: `It ends today. Its plan visits that have not started are cancelled and no new ones are added; visits under way or finished stay on record. Nothing is refunded by this: an invoice already raised for the current cycle (to ${longDay(subscription.currentPeriodEnd)}) stays as it is, and is dealt with in Invoices. This cannot be undone; the outlet can be put on a plan again.`,
      confirmLabel: "Cancel the plan now",
      cancelLabel: "Keep the plan",
    });
    if (!sure) return;
    const before = await planVisitIds(outlet.id);
    await act(
      () => api.subscriptions.cancel(outlet.id, "NOW"),
      () => `${outlet.name} is no longer on a plan`,
    );
    const cancelled = countMissingFrom(before, await planVisitIds(outlet.id));
    if (cancelled) notify(`${outlet.name} is no longer on a plan; ${visitCount(cancelled)} cancelled`);
  }

  const link = (label: string, onClick: () => void) => (
    <Button variant="link" disabled={busy} aria-label={`${label}: ${outlet.name}`} onClick={onClick}>
      {label}
    </Button>
  );

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {subscription ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold">{planName} plan</span>
            <Tag>{stateOf(subscription)}</Tag>
          </p>
        ) : (
          <p className="text-muted">
            No plan
            {loaded.lastEnded && ` · the ${english(loaded.lastEnded.plan.name)} plan ended on ${longDay(loaded.lastEnded.endedOn)}`}
          </p>
        )}
        {form === null && (
          <div className="flex flex-wrap gap-x-1">
            {!subscription && link("Put on a plan", () => setForm("start"))}
            {subscription && !subscription.endsOn && !subscription.pendingPlan && link("Change plan", () => setForm("change"))}
            {subscription?.pendingPlan &&
              link("Undo the change of plan", () =>
                void act(() => api.subscriptions.undoChangePlan(outlet.id), () => `${outlet.name} stays on the ${planName} plan`),
              )}
            {subscription?.endsOn &&
              link("Keep the plan", () =>
                void act(() => api.subscriptions.keep(outlet.id), () => `${outlet.name} keeps the ${planName} plan; it will renew as before`),
              )}
            {subscription?.status === "ACTIVE" && link("Pause", () => void pause())}
            {subscription?.status === "PAUSED" && link("Resume", () => void resume())}
            {subscription && !subscription.endsOn && link("Cancel at the end of the cycle", () => void cancelAtEnd())}
            {subscription && link("Cancel now", () => void cancelNow())}
          </div>
        )}
      </div>

      {/* A change that failed is said here, with the outlet it concerns. */}
      <ErrorMessage message={error} />

      {subscription && (
        <dl className="grid max-w-3xl gap-x-6 gap-y-1 sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted">Price</dt>
          <dd>{quoted(subscription)}</dd>
          <dt className="text-muted">Current cycle</dt>
          <dd>
            {longDay(subscription.currentPeriodStart)} to {longDay(subscription.currentPeriodEnd)}
            <span className="text-muted"> · on a plan since {longDay(subscription.startDate)}</span>
          </dd>
          <dt className="text-muted">Next invoice</dt>
          <dd>
            {subscription.renewal ? (
              <>
                {longDay(subscription.renewal.date)}, for {rupees(subscription.renewal.totalPaise)} with GST
                {subscription.renewal.changes && (
                  <span className="text-muted">
                    {" "}
                    ·{" "}
                    {subscription.pendingPlan
                      ? `the ${english(subscription.renewal.plan.name)} plan starts that day: ${quoted(subscription.renewal)}`
                      : `the plan has been edited since this cycle began; from that day: ${quoted(subscription.renewal)}, with the services as they are then on the Plans page`}
                  </span>
                )}
              </>
            ) : subscription.endsOn ? (
              `None: the plan ends on ${longDay(subscription.endsOn)} and is not renewed`
            ) : (
              "None while it is paused"
            )}
          </dd>
        </dl>
      )}

      {subscription && subscription.services.length > 0 && (
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
            {subscription.services.map((service) => (
              <tr key={service.serviceCode}>
                <td className="py-1 pr-4">{english(service.serviceName)}</td>
                <td className="py-1 pr-4 text-muted">{everySoOften(service.intervalDays)}</td>
                <td className="py-1">{service.nextDate ? shortDay(service.nextDate) : <span className="text-muted">None coming</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {form && (
        <PlanChoiceForm
          outlet={outlet}
          current={subscription}
          onSaved={(next, message) => {
            setLoaded(next);
            setForm(null);
            notify(message);
          }}
          onCancel={() => setForm(null)}
        />
      )}
    </div>
  );
}

/**
 * Puts an outlet on a plan from days ECCS chooses, or (when it is already on
 * one) asks for a different plan from its next cycle.
 */
function PlanChoiceForm({
  outlet,
  current,
  onSaved,
  onCancel,
}: {
  outlet: Outlet;
  /** The subscription the outlet has now, if any: then this form changes its plan. */
  current: SubscriptionDto | null;
  onSaved: (next: OutletSubscriptionDto, message: string) => void;
  onCancel: () => void;
}) {
  const [plans, setPlans] = useState<PlanOfferDto[] | null>(null);
  const [planCode, setPlanCode] = useState("");
  const [startDate, setStartDate] = useState(today());
  // Empty means "the same day the plan starts".
  const [firstVisitDate, setFirstVisitDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  // The plans on offer are fetched when the form opens, so a plan added since the page loaded is in the list.
  useEffect(() => {
    let cancelled = false;
    api.subscriptionPlans
      .offered()
      .then((list) => !cancelled && setPlans(list))
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const choices = plans?.filter((plan) => plan.code !== current?.plan.code) ?? [];
  const chosen = plans?.find((plan) => plan.code === planCode);
  const changeDay = current ? longDay(current.renewal?.date ?? current.currentPeriodEnd) : "";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: FieldErrors = {};
    if (!planCode) found.planCode = "Choose a plan.";
    if (!current) {
      if (!startDate) found.startDate = "Choose a start date.";
      else if (startDate < today()) found.startDate = "Choose today or a later date.";
      if (firstVisitDate && startDate && firstVisitDate < startDate) found.firstVisitDate = "The first visits cannot be before the plan starts.";
    }
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(event.currentTarget, found);

    setBusy(true);
    setError(null);
    try {
      if (current) {
        const next = await api.subscriptions.changePlan(outlet.id, planCode);
        return onSaved(next, `${outlet.name} moves to the ${chosen ? english(chosen.name) : "new"} plan on ${changeDay}`);
      }
      const before = await planVisitIds(outlet.id);
      const firstVisits = firstVisitDate || startDate;
      const next = await api.subscriptions.start(outlet.id, { planCode, startDate, firstVisitDate: firstVisits });
      // Only visits that were not in the diary before are counted.
      const added = countMissingFrom(await planVisitIds(outlet.id), before);
      const visits =
        added === null
          ? ""
          : added > 0
            ? `; ${visitCount(added)} added to the diary`
            : `; its visits go in the diary ${PLAN_VISITS_DAYS_AHEAD} days before they are due`;
      onSaved(next, `${outlet.name} is now on the ${chosen ? english(chosen.name) : "new"} plan${visits}`);
    } catch (e) {
      setError(describe(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-2xl flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h3 className="text-base font-bold">{current ? `Change the plan of ${outlet.name}` : `Put ${outlet.name} on a plan`}</h3>
      {plans === null && !error && <Loading>Loading the plans…</Loading>}
      {plans && choices.length === 0 && (
        <p className="text-muted">{current ? "There is no other plan on offer to change to." : "There are no plans on offer yet. Add one on the Plans page."}</p>
      )}
      {plans && choices.length > 0 && (
        <>
          <div className="grid items-start gap-3 sm:grid-cols-2">
            <SelectField
              label={current ? "New plan" : "Plan"}
              name="planCode"
              autoFocus
              value={planCode}
              error={errors.planCode}
              wrapperClassName="sm:col-span-2"
              onChange={(e) => setPlanCode(e.target.value)}
            >
              <option value="">Choose a plan</option>
              {choices.map((plan) => (
                <option key={plan.code} value={plan.code}>
                  {english(plan.name)}: {quoted(plan)}
                </option>
              ))}
            </SelectField>
            {!current && (
              <>
                <Field
                  label="Start date"
                  name="startDate"
                  type="date"
                  required
                  min={today()}
                  hint="The first billing cycle starts on this day, and the first invoice is for it."
                  value={startDate}
                  error={errors.startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
                <Field
                  label="First visits on"
                  name="firstVisitDate"
                  type="date"
                  min={startDate || today()}
                  hint="Every service of the plan is first due on this day. Left empty: the start date."
                  value={firstVisitDate}
                  error={errors.firstVisitDate}
                  onChange={(e) => setFirstVisitDate(e.target.value)}
                />
              </>
            )}
          </div>
          {chosen && (
            <p>
              <span className="font-semibold">{english(chosen.name)} includes:</span>{" "}
              {chosen.services.map((service) => `${english(service.serviceName)} ${everySoOften(service.intervalDays)}`).join(", ")}.
            </p>
          )}
          <p className="text-muted">
            {current
              ? `Nothing changes until ${changeDay}: the ${english(current.plan.name)} plan runs to the end of the cycle already invoiced. From that day the new plan's price and services apply and the invoice is for the new price. Services that are not in the new plan stop then. The change can be undone until that day.`
              : `The price and billing cycle are fixed from the plan as it is today, for the first cycle. Visits already in the diary for this outlet stay as they are; the plan's visits go in by themselves, ${PLAN_VISITS_DAYS_AHEAD} days before each is due.`}
          </p>
        </>
      )}
      <ErrorMessage message={error} />
      <div className="flex flex-wrap gap-2">
        {plans && choices.length > 0 && (
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
