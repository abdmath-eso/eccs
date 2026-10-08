"use client";

import {
  BILLING_CYCLES,
  can,
  createPlanSchema,
  planLineSchema,
  PLAN_MAX_LINES,
  subscriptionPrice,
  type BillingCycle,
  type PlanAdminDto,
  type PlansAdminDto,
} from "@eccs/shared";
import { useEffect, useState, type FormEvent } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { Button, Card, CONTROL_STYLE, ErrorMessage, Field, LoadError, Loading, NoAccess, PageHeader, SelectField, TextAreaField } from "@/components/ui";
import { api } from "@/lib/api";
import { checkAgainst, focusFirstError, formValues, hasErrors, type FieldErrors } from "@/lib/forms";
import { describe, english } from "@/lib/format";
import { useSession } from "@/lib/session";

type Kind = PlansAdminDto["kinds"][number];
/** One line of the form while it is being typed: figures are still text. */
interface LineDraft {
  /** Only for React, so a removed line takes the right boxes with it. */
  key: number;
  serviceCode: string;
  intervalDays: string;
}

const CYCLE_NAME: Record<BillingCycle, string> = { MONTHLY: "Monthly", QUARTERLY: "Quarterly", ANNUAL: "Annual" };
const PER_CYCLE: Record<BillingCycle, string> = { MONTHLY: "a month", QUARTERLY: "a quarter", ANNUAL: "a year" };

/** An amount in paise as rupees, with paise shown only when there are any: "₹6,000" or "₹1,080.50". */
const price = (paise: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(paise / 100);

const everySoOften = (days: number) => (days === 1 ? "every day" : `every ${days} days`);
const outlets = (count: number) => `${count} outlet${count === 1 ? "" : "s"}`;

/** Whether a name is also written in languages other than English (which the console does not change). */
const isTranslated = (text: Partial<Record<string, string>> | null) =>
  Object.entries(text ?? {}).some(([code, wording]) => code !== "en" && wording);

const translationHint = (text: Partial<Record<string, string>> | null) =>
  isTranslated(text)
    ? "This changes the English only. The other languages keep their wording until someone re-translates them."
    : "Written in English. It shows in English to everyone until it is translated.";

/** A word saying where something stands, in a box so it does not rely on colour. */
function Tag({ children }: { children: string }) {
  return <span className="rounded-md border border-border-strong px-1.5 py-0.5 text-xs font-semibold text-muted">{children}</span>;
}

/** Makes a change, puts what the server sent back on the page and confirms it briefly. Returns what went wrong, if anything. */
type Change = (action: () => Promise<PlansAdminDto>, done: string) => Promise<string | null>;

/**
 * Plans: the bundles of services ECCS sells on a cycle. For Super Admins and
 * Operations Managers. Laid out like the Catalogue page: what is on offer
 * first, what is no longer offered folded away underneath, and each plan
 * changed where it stands.
 *
 * A plan is never deleted. "Stop offering" only stops new subscribers. And an
 * edit never reaches an outlet in the middle of a cycle it has been invoiced
 * for: each subscriber keeps this cycle's price and services, and moves to the
 * edited plan when its next cycle starts. The edit form says so, with the
 * number of outlets it concerns, before anything is saved.
 */
export default function PlansScreen() {
  const { user } = useSession();
  const notify = useToast();
  const [data, setData] = useState<PlansAdminDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [adding, setAdding] = useState(false);

  const mayManage = user ? can(user.memberships, "catalog", "update") : false;

  useEffect(() => {
    if (!mayManage) return;
    let cancelled = false;
    api.subscriptionPlans
      .all()
      .then((loaded) => {
        if (cancelled) return;
        setData(loaded);
        setError(null);
      })
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [mayManage, attempt]);

  if (!mayManage) {
    return (
      <NoAccess title="Plans">Plans are managed by Super Admins and Operations Managers.</NoAccess>
    );
  }

  const change: Change = async (action, done) => {
    try {
      setData(await action());
      notify(done);
      return null;
    } catch (e) {
      return describe(e);
    }
  };

  const offered = data?.plans.filter((plan) => plan.isActive) ?? [];
  const notOffered = data?.plans.filter((plan) => !plan.isActive) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Plans"
        description="What a restaurant can subscribe to: a set of services, each repeated every so many days, for one price per billing cycle."
        action={data && !adding && <Button onClick={() => setAdding(true)}>Add a plan</Button>}
        how={
          <>
            <p>Prices here are before GST; the app shows restaurants the price with GST.</p>
            <p>
              Changing a plan never changes what an outlet already on it pays or gets in its current cycle: the change reaches each
              outlet when its next cycle starts.
            </p>
            <p>Plans are never deleted; you stop offering one, and outlets already on it keep it.</p>
          </>
        }
      />

      <LoadError message={error} onRetry={() => setAttempt((current) => current + 1)} />
      {data === null && !error && <Loading />}

      {data && adding && (
        <Card>
          <PlanForm kinds={data.kinds} onChange={change} onClose={() => setAdding(false)} />
        </Card>
      )}

      {data && (
        <section className="flex flex-col gap-4" aria-labelledby="offered-heading">
          <h2 id="offered-heading" className="text-xl font-bold">
            On offer ({offered.length})
          </h2>
          {offered.length === 0 && <p className="text-muted">No plan is on offer. Restaurants cannot subscribe until you add one or offer one again.</p>}
          {offered.map((plan) => (
            <PlanCard key={plan.id} plan={plan} kinds={data.kinds} onChange={change} />
          ))}
        </section>
      )}

      {data && notOffered.length > 0 && (
        <details>
          <summary className="cursor-pointer rounded-md py-1 text-lg font-bold text-primary">No longer offered ({notOffered.length})</summary>
          <p className="mt-1 mb-4 text-sm text-muted">
            Restaurants cannot choose these. Outlets that were already on one keep it and go on renewing until they change plan or
            cancel.
          </p>
          <div className="flex flex-col gap-4">
            {notOffered.map((plan) => (
              <PlanCard key={plan.id} plan={plan} kinds={data.kinds} onChange={change} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/** One plan: what it is, what it includes, who is on it, and its two actions. */
function PlanCard({ plan, kinds, onChange }: { plan: PlanAdminDto; kinds: Kind[]; onChange: Change }) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = english(plan.name);
  const kindOff = (code: string) => kinds.find((kind) => kind.code === code)?.isActive === false;

  async function setOffered(isActive: boolean) {
    if (!isActive) {
      const sure = await confirm({
        title: `Stop offering the ${name} plan?`,
        body: `Restaurants will no longer be able to choose it. ${
          plan.subscriberCount > 0
            ? `The ${outlets(plan.subscriberCount)} already on it keep${plan.subscriberCount === 1 ? "s" : ""} it and go${plan.subscriberCount === 1 ? "es" : ""} on renewing.`
            : "No outlet is on it."
        } Nothing is deleted, and you can offer it again at any time.`,
        confirmLabel: "Stop offering it",
        cancelLabel: "Keep offering it",
      });
      if (!sure) return;
    }
    setBusy(true);
    setError(
      await onChange(() => api.subscriptionPlans.update(plan.id, { isActive }), isActive ? `On offer again: ${name}` : `No longer offered: ${name}`),
    );
    setBusy(false);
  }

  if (editing) {
    return (
      <Card className="border-primary">
        <PlanForm plan={plan} kinds={kinds} onChange={onChange} onClose={() => setEditing(false)} />
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div>
          <h3 className="flex flex-wrap items-center gap-2 text-lg font-bold">
            {name}
            {!plan.isActive && <Tag>No longer offered</Tag>}
          </h3>
          {plan.description && <p className="text-muted">{english(plan.description)}</p>}
        </div>
        <div className="flex flex-wrap gap-x-1">
          <Button variant="link" disabled={busy} aria-label={`Change the ${name} plan`} onClick={() => setEditing(true)}>
            Change
          </Button>
          <Button
            variant="link"
            loading={busy}
            aria-label={plan.isActive ? `Stop offering the ${name} plan` : `Offer the ${name} plan again`}
            onClick={() => void setOffered(!plan.isActive)}
          >
            {plan.isActive ? "Stop offering" : "Offer again"}
          </Button>
        </div>
      </div>

      <ErrorMessage message={error} />

      <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted">Price before GST</dt>
          <dd className="text-base font-semibold">
            {price(plan.pricePaise)} {PER_CYCLE[plan.billingCycle]}
          </dd>
          <dd className="text-muted">
            Restaurants pay {price(plan.totalPaise)} with {plan.gstRatePercent}% GST
          </dd>
        </div>
        <div>
          <dt className="text-muted">Billed</dt>
          <dd className="text-base font-semibold">{CYCLE_NAME[plan.billingCycle]}, in advance</dd>
        </div>
        <div>
          <dt className="text-muted">Outlets on it now</dt>
          <dd className="text-base font-semibold">{plan.subscriberCount}</dd>
          {plan.incomingCount > 0 && <dd className="text-muted">{outlets(plan.incomingCount)} moving to it at the next cycle</dd>}
        </div>
      </dl>

      <table className="w-full max-w-2xl text-left text-sm">
        <caption className="sr-only">Services in the {name} plan</caption>
        <thead className="text-muted">
          <tr className="border-b border-border">
            <th scope="col" className="py-1.5 pr-4 font-medium">
              Service
            </th>
            <th scope="col" className="py-1.5 font-medium">
              How often
            </th>
          </tr>
        </thead>
        <tbody>
          {plan.services.map((service) => (
            <tr key={service.serviceCode} className="border-b border-border last:border-0">
              <td className="py-1.5 pr-4">
                {english(service.serviceName)}
                {/* Why a service that is in the plan produces no visits. */}
                {kindOff(service.serviceCode) && <span className="text-muted"> · this kind is switched off in Catalogue, so no visits are made</span>}
              </td>
              <td className="py-1.5 text-muted">{everySoOften(service.intervalDays)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/** Adds a plan, or changes one. The lines are a list that rows can be added to and removed from. */
function PlanForm({ plan, kinds, onChange, onClose }: { plan?: PlanAdminDto; kinds: Kind[]; onChange: Change; onClose: () => void }) {
  const [lines, setLines] = useState<LineDraft[]>(() =>
    plan
      ? plan.services.map((service, index) => ({ key: index, serviceCode: service.serviceCode, intervalDays: String(service.intervalDays) }))
      : [{ key: 0, serviceCode: "", intervalDays: "" }],
  );
  const [nextKey, setNextKey] = useState(lines.length);
  // Kept in state, not only in the form, so the price with GST can be shown while it is typed.
  const [priceRupees, setPriceRupees] = useState(plan ? String(plan.pricePaise / 100) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [lineErrors, setLineErrors] = useState<Record<number, string>>({});

  const name = plan ? english(plan.name) : "";
  const typedPrice = Number(priceRupees);
  const withGst = priceRupees.trim() !== "" && Number.isFinite(typedPrice) && typedPrice >= 0 ? subscriptionPrice(Math.round(typedPrice * 100)) : null;
  // A kind already in another line is not offered again: a plan has each kind once.
  const taken = (own: string) => new Set(lines.map((line) => line.serviceCode).filter((code) => code && code !== own));

  const setLine = (key: number, patch: Partial<LineDraft>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  function addLine() {
    setLines((current) => [...current, { key: nextKey, serviceCode: "", intervalDays: "" }]);
    setNextKey((current) => current + 1);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formValues(form);
    const input = {
      name: values.name ?? "",
      description: values.description ?? "",
      priceRupees,
      billingCycle: (values.billingCycle ?? "") as BillingCycle,
      lines: lines.map((line) => ({ serviceCode: line.serviceCode, intervalDays: line.intervalDays })),
    };
    // The same rules the server checks. Each line is also checked by itself, so the message sits beside the line it is about.
    const found = checkAgainst(createPlanSchema, input);
    const perLine: Record<number, string> = {};
    for (const line of lines) {
      const checked = planLineSchema.safeParse(line);
      if (!checked.success) perLine[line.key] = checked.error.issues[0]?.message ?? "Check this line";
    }
    if (Object.keys(perLine).length > 0) delete found.lines;
    setErrors(found);
    setLineErrors(perLine);
    if (hasErrors(found) || Object.keys(perLine).length > 0) return focusFirstError(form, found);

    setBusy(true);
    const failed = await onChange(
      () => (plan ? api.subscriptionPlans.update(plan.id, input) : api.subscriptionPlans.create(input)),
      plan
        ? plan.subscriberCount > 0
          ? `Saved: ${input.name.trim()}. Outlets already on it change at their next cycle.`
          : `Saved: ${input.name.trim()}`
        : `Now on offer: ${input.name.trim()}`,
    );
    setBusy(false);
    setError(failed);
    if (!failed) onClose();
  }

  return (
    <form onSubmit={submit} noValidate className="grid items-start gap-4 sm:grid-cols-2">
      <h3 className="text-lg font-bold sm:col-span-2">{plan ? `Change the ${name} plan` : "Add a plan"}</h3>

      {/* Said before anything is typed, not after saving: who this edit concerns and when it reaches them. */}
      {plan && plan.subscriberCount > 0 && (
        <p className="rounded-lg border border-border-strong px-3 py-2 text-sm sm:col-span-2" role="note">
          <strong>
            {outlets(plan.subscriberCount)} {plan.subscriberCount === 1 ? "is" : "are"} on this plan now.
          </strong>{" "}
          Saving does not change what {plan.subscriberCount === 1 ? "it pays or gets" : "they pay or get"} in the cycle already
          invoiced. Each outlet moves to the new price, billing cycle and services on the day its next cycle starts, and its next
          invoice is for the new price. A service you remove stops for that outlet from that day, and its visits after it that have
          not started are cancelled. Tell the restaurants before a price goes up.
        </p>
      )}
      {plan && plan.subscriberCount === 0 && (
        <p className="text-sm text-muted sm:col-span-2">No outlet is on this plan, so a change affects only those who subscribe from now on.</p>
      )}

      <Field
        label="Name, in English"
        name="name"
        required
        maxLength={80}
        autoFocus
        defaultValue={name}
        hint={plan ? translationHint(plan.name) : "For example: Essential"}
        error={errors.name}
      />
      <SelectField
        label="Billing cycle"
        name="billingCycle"
        defaultValue={plan?.billingCycle ?? "MONTHLY"}
        hint="How often it is invoiced, in advance. The price below is for one cycle."
        error={errors.billingCycle}
      >
        {BILLING_CYCLES.map((cycle) => (
          <option key={cycle} value={cycle}>
            {CYCLE_NAME[cycle]}
          </option>
        ))}
      </SelectField>
      <Field
        label="Price per cycle before GST, in rupees"
        name="priceRupees"
        inputMode="decimal"
        required
        value={priceRupees}
        onChange={(e) => setPriceRupees(e.target.value)}
        hint={
          withGst
            ? `Restaurants will see ${price(withGst.totalPaise)}: ${price(withGst.pricePaise)} + ${price(withGst.gstPaise)} GST (${withGst.gstRatePercent}%).`
            : "Figures only, for example 6000."
        }
        error={errors.priceRupees}
      />
      <TextAreaField
        label="Description, in English"
        name="description"
        rows={2}
        maxLength={500}
        defaultValue={plan?.description ? english(plan.description) : ""}
        hint={plan?.description ? translationHint(plan.description) : "A line the restaurant reads when choosing a plan."}
        error={errors.description}
      />

      <fieldset className="flex flex-col gap-2 sm:col-span-2">
        <legend className="font-semibold">What the plan includes</legend>
        <p className="text-sm text-muted">
          One line for each kind of service, and every how many days it is done. Its visits are put in the outlet&apos;s diary by
          themselves.
        </p>
        {errors.lines && <ErrorMessage message={errors.lines} />}
        <ul className="flex flex-col gap-3">
          {lines.map((line, index) => {
            const others = taken(line.serviceCode);
            return (
              <li key={line.key} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex min-w-0 flex-1 basis-56 flex-col gap-1 text-sm font-medium">
                    Service {index + 1}
                    <select
                      name={`line-${line.key}-serviceCode`}
                      className={CONTROL_STYLE}
                      value={line.serviceCode}
                      aria-invalid={lineErrors[line.key] ? true : undefined}
                      onChange={(e) => setLine(line.key, { serviceCode: e.target.value })}
                    >
                      <option value="">Choose a kind of service</option>
                      {kinds
                        .filter((kind) => !others.has(kind.code))
                        .map((kind) => (
                          <option key={kind.code} value={kind.code}>
                            {english(kind.name)}
                            {kind.isActive ? "" : " (switched off)"}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="flex w-40 flex-col gap-1 text-sm font-medium">
                    Every how many days
                    <input
                      name={`line-${line.key}-intervalDays`}
                      className={CONTROL_STYLE}
                      inputMode="numeric"
                      maxLength={3}
                      placeholder="For example 15"
                      value={line.intervalDays}
                      aria-invalid={lineErrors[line.key] ? true : undefined}
                      onChange={(e) => setLine(line.key, { intervalDays: e.target.value })}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="link"
                    disabled={lines.length === 1}
                    aria-label={`Remove service ${index + 1}`}
                    onClick={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}
                  >
                    Remove
                  </Button>
                </div>
                <ErrorMessage message={lineErrors[line.key] ?? null} />
              </li>
            );
          })}
        </ul>
        <div>
          <Button type="button" variant="link" className="-ml-2" disabled={lines.length >= Math.min(PLAN_MAX_LINES, kinds.length)} onClick={addLine}>
            + Add a service
          </Button>
        </div>
      </fieldset>

      {!plan && (
        <p className="text-sm text-muted sm:col-span-2">
          It is written in English and shows in English to everyone until it is translated. Restaurants can subscribe to it as
          soon as you add it.
        </p>
      )}

      <div className="flex flex-col gap-3 sm:col-span-2">
        <ErrorMessage message={error} />
        <div className="flex gap-3">
          <Button type="submit" loading={busy}>
            {plan ? "Save" : "Add the plan"}
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}
