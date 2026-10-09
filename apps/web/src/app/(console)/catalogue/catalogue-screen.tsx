"use client";

import {
  addServiceTaskSchema,
  can,
  createCatalogItemSchema,
  createServiceKindSchema,
  SERVICE_CATEGORIES,
  SERVICE_CATEGORY_ENGLISH,
  serviceCodeFromName,
  updateCatalogItemSchema,
  updateServiceKindSchema,
  updateServiceTaskSchema,
  type CatalogAdminDto,
  type CatalogAdminItemDto,
  type ServiceKindAdminDto,
  type ServiceTaskAdminDto,
} from "@eccs/shared";
import { useEffect, useState, type FormEvent } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { Button, Card, ErrorMessage, Field, LoadError, Loading, NoAccess, PageHeader, SelectField, TextAreaField } from "@/components/ui";
import { api } from "@/lib/api";
import { checkAgainst, focusFirstError, formValues, hasErrors, type FieldErrors } from "@/lib/forms";
import { describe, english } from "@/lib/format";
import { useSession } from "@/lib/session";

const LANGUAGE: Record<string, string> = {
  hi: "Hindi",
  te: "Telugu",
  ta: "Tamil",
  kn: "Kannada",
  ml: "Malayalam",
  mr: "Marathi",
  bn: "Bengali",
  gu: "Gujarati",
  pa: "Punjabi",
  or: "Odia",
  ur: "Urdu",
};

/** The languages, other than English, that a name is already written in. */
const otherLanguages = (text: Partial<Record<string, string>> | null) =>
  Object.entries(text ?? {})
    .filter(([code, wording]) => code !== "en" && wording)
    .map(([code]) => LANGUAGE[code] ?? code);

/** "Telugu and Hindi", or "Telugu, Hindi and 9 other languages" when the list is long. */
function listed(names: string[]) {
  if (names.length <= 3) return names.join(", ").replace(/, ([^,]*)$/, " and $1");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} other languages`;
}

/**
 * The console writes English only. This is what to say beside a box whose
 * wording also exists in other languages: they are not changed with it.
 */
function translationHint(text: Partial<Record<string, string>> | null) {
  const others = otherLanguages(text);
  if (others.length === 0) return "Written in English. It shows in English to everyone until it is translated.";
  return `This changes the English only. The ${listed(others)} wording stays as it is until someone re-translates it.`;
}

/** An amount in paise as rupees, with paise shown only when there are any: "₹1,800" or "₹1,750.50". */
const price = (paise: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(paise / 100);

/** Minutes as "45 min", "2 h" or "1 h 30 min". */
function duration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours > 0 ? `${hours} h` : "", rest > 0 || hours === 0 ? `${rest} min` : ""].filter(Boolean).join(" ");
}

const times = (count: number) => (count === 1 ? "once" : `${count} times`);

/**
 * Makes a change, puts the catalogue the server sent back on the page and
 * confirms it briefly. Returns `null` if it worked, or what went wrong, for
 * the row or form that asked to show beside itself.
 */
type Change = (action: () => Promise<CatalogAdminDto>, done: string) => Promise<string | null>;

/** A word saying where something stands, in a box so it does not rely on colour. */
function Tag({ children }: { children: string }) {
  return <span className="rounded-md border border-border-strong px-1.5 py-0.5 text-xs font-semibold text-muted">{children}</span>;
}

/**
 * Catalogue: what ECCS offers. The services a restaurant can book and their
 * prices, the kinds of service, and the tasks a Supervisor ticks during a
 * visit of each kind. For Super Admins and Operations Managers.
 *
 * Nothing here is deleted, because bookings and finished visits refer to it:
 * a service is stopped being offered and a task is retired, and both can be
 * brought back. Plans are edited on the Plans page.
 */
export default function CatalogueScreen() {
  const { user } = useSession();
  const notify = useToast();
  const [catalogue, setCatalogue] = useState<CatalogAdminDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [addingKind, setAddingKind] = useState(false);

  const mayManage = user ? can(user.memberships, "catalog", "update") : false;

  useEffect(() => {
    if (!mayManage) return;
    let cancelled = false;
    api.catalogue
      .get()
      .then((loaded) => {
        if (cancelled) return;
        setCatalogue(loaded);
        setError(null);
      })
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [mayManage, attempt]);

  if (!mayManage) {
    return (
      <NoAccess title="Catalogue">The catalogue is managed by Super Admins and Operations Managers.</NoAccess>
    );
  }

  const change: Change = async (action, done) => {
    try {
      setCatalogue(await action());
      notify(done);
      return null;
    } catch (e) {
      return describe(e);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Catalogue"
        description="The services restaurants can book, their prices, and the tasks a Supervisor ticks during each kind of visit."
        how={
          <>
            <p>
              Nothing is ever deleted here, because bookings and finished visits refer to it: you stop offering a service or retire a
              task, and can bring either back.
            </p>
            <p>Plans and their prices are on the Plans page.</p>
          </>
        }
      />

      <LoadError message={error} onRetry={() => setAttempt((current) => current + 1)} />
      {catalogue === null && !error && <Loading />}

      {catalogue && (
        <>
          <ServicesCard catalogue={catalogue} onChange={change} />
          <section className="flex flex-col gap-4" aria-labelledby="kinds-heading">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1 basis-96">
                <h2 id="kinds-heading" className="text-xl font-bold">
                  Kinds of service and their tasks
                </h2>
                <p className="text-muted">
                  The Supervisor ticks these tasks during a visit, in this order. Retiring a task takes it off new visits; visits
                  already done keep it. Reword a task only to make it clearer, because the new wording also shows on past reports:
                  if the work itself has changed, retire the task and add a new one.
                </p>
              </div>
              {!addingKind && (
                <Button variant="secondary" onClick={() => setAddingKind(true)}>
                  Add a kind of service
                </Button>
              )}
            </div>
            {addingKind && <AddKindForm kinds={catalogue.kinds} onChange={change} onClose={() => setAddingKind(false)} />}
            {catalogue.kinds.map((kind) => (
              <KindCard key={kind.code} kind={kind} onChange={change} onLoaded={setCatalogue} />
            ))}
          </section>
        </>
      )}
    </div>
  );
}

// ───────────────────────── Bookable services ─────────────────────────

function ServicesCard({ catalogue, onChange }: { catalogue: CatalogAdminDto; onChange: Change }) {
  const [adding, setAdding] = useState(false);
  const kinds = new Map(catalogue.kinds.map((kind) => [kind.code, kind]));
  // "Offered" is what a restaurant can book today: the service is on offer and so is its kind.
  const offered = catalogue.items.filter((item) => item.isActive && kinds.get(item.serviceCode)?.isActive);
  const notOffered = catalogue.items.filter((item) => !offered.includes(item));

  const table = (items: CatalogAdminItemDto[], caption: string) => (
    <div className="-mx-2 overflow-x-auto px-2">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-muted">
          <tr className="border-b border-border">
            <th scope="col" className="py-2 pr-4 font-medium">
              Service
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Kind
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Price before GST
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Usual time
            </th>
            <th scope="col" className="py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <ServiceRow key={item.id} item={item} kinds={catalogue.kinds} onChange={onChange} />
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">Services restaurants can book</h2>
          <p className="text-muted">
            What the Owner and Manager see under Book a service in the app. A price that has already been booked is never
            altered: changing it keeps the old service on record and puts a new one on offer, so earlier requests and visits go
            on showing the price agreed at the time.
          </p>
        </div>
        {!adding && <Button onClick={() => setAdding(true)}>Add a service</Button>}
      </div>

      {adding && <AddServiceForm kinds={catalogue.kinds} onChange={onChange} onClose={() => setAdding(false)} />}

      {offered.length === 0 ? <p className="text-muted">Nothing is on offer at the moment.</p> : table(offered, "Services on offer")}

      {notOffered.length > 0 && (
        <details>
          <summary className="cursor-pointer rounded-md py-1 font-semibold text-primary">No longer offered ({notOffered.length})</summary>
          <p className="mt-1 text-sm text-muted">
            Kept because requests and visits refer to them, or because you may want them back. Restaurants do not see these.
          </p>
          {table(notOffered, "Services no longer offered")}
        </details>
      )}
    </Card>
  );
}

/** The boxes shared by adding and changing a service. */
function ServiceFields({ item, kinds, errors }: { item?: CatalogAdminItemDto; kinds: ServiceKindAdminDto[]; errors: FieldErrors }) {
  return (
    <>
      <Field
        label="Name, in English"
        name="name"
        required
        maxLength={120}
        autoFocus
        defaultValue={item ? english(item.name) : ""}
        hint={item ? translationHint(item.name) : "For example: Pest control, single visit"}
        error={errors.name}
      />
      <SelectField
        label="Kind of service"
        name="serviceCode"
        defaultValue={item?.serviceCode ?? ""}
        hint="Decides which task list its visits use."
        error={errors.serviceCode}
      >
        {!item && <option value="">Choose a kind</option>}
        {kinds.map((kind) => (
          <option key={kind.code} value={kind.code}>
            {english(kind.name)}
            {kind.isActive ? "" : " (switched off)"}
          </option>
        ))}
      </SelectField>
      <Field
        label="Price before GST, in rupees"
        name="priceRupees"
        inputMode="decimal"
        required
        defaultValue={item ? String(item.pricePaise / 100) : ""}
        hint="Figures only, for example 1800."
        error={errors.priceRupees}
      />
      <Field
        label="Usual time on site, in minutes"
        name="durationMinutes"
        inputMode="numeric"
        required
        defaultValue={item ? String(item.durationMinutes) : ""}
        hint="For example 90 for an hour and a half."
        error={errors.durationMinutes}
      />
      <TextAreaField
        label="Description, in English"
        name="description"
        rows={2}
        maxLength={500}
        wrapperClassName="sm:col-span-2"
        defaultValue={item?.description ? english(item.description) : ""}
        hint={item?.description ? translationHint(item.description) : "A line the restaurant reads before booking."}
        error={errors.description}
      />
    </>
  );
}

function AddServiceForm({ kinds, onChange, onClose }: { kinds: ServiceKindAdminDto[]; onChange: Change; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formValues(form);
    const found = checkAgainst(createCatalogItemSchema, values);
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);

    setBusy(true);
    const failed = await onChange(
      () =>
        api.catalogue.addItem({
          serviceCode: values.serviceCode ?? "",
          name: values.name ?? "",
          description: values.description,
          priceRupees: values.priceRupees,
          durationMinutes: values.durationMinutes,
        }),
      `Now on offer: ${values.name?.trim()}`,
    );
    setBusy(false);
    setError(failed);
    if (!failed) onClose();
  }

  return (
    <form onSubmit={submit} noValidate className="grid items-start gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
      <h3 className="text-base font-bold sm:col-span-2">Add a service</h3>
      <ServiceFields kinds={kinds} errors={errors} />
      <p className="text-sm text-muted sm:col-span-2">
        It is written in English and shows in English to everyone, whatever language their app is in, until it is translated.
        Restaurants can book it as soon as you add it.
      </p>
      <div className="flex flex-col gap-3 sm:col-span-2">
        <ErrorMessage message={error} />
        <div className="flex gap-3">
          <Button type="submit" loading={busy}>
            Add the service
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}

function ServiceRow({ item, kinds, onChange }: { item: CatalogAdminItemDto; kinds: ServiceKindAdminDto[]; onChange: Change }) {
  const confirm = useConfirm();
  const notify = useToast();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  const name = english(item.name);
  const kind = kinds.find((entry) => entry.code === item.serviceCode);

  async function setOffered(isActive: boolean) {
    if (!isActive) {
      const sure = await confirm({
        title: `Stop offering ${name}?`,
        body: "Restaurants will no longer be able to book it. Requests and visits already made for it are not affected, and you can offer it again at any time.",
        confirmLabel: "Stop offering it",
        cancelLabel: "Keep offering it",
      });
      if (!sure) return;
    }
    setBusy(true);
    setError(
      await onChange(
        () => api.catalogue.updateItem(item.id, { isActive }).then((result) => result.catalogue),
        isActive ? `On offer again: ${name}` : `No longer offered: ${name}`,
      ),
    );
    setBusy(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formValues(form);
    const found = checkAgainst(updateCatalogItemSchema, values);
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);

    const renamed = (values.name ?? "").trim() !== name && otherLanguages(item.name).length > 0;
    let replaced = false;
    setBusy(true);
    const failed = await onChange(async () => {
      const result = await api.catalogue.updateItem(item.id, {
        serviceCode: values.serviceCode,
        name: values.name,
        description: values.description,
        priceRupees: values.priceRupees,
        durationMinutes: values.durationMinutes,
      });
      replaced = result.replacedById !== null;
      return result.catalogue;
    }, `Saved: ${values.name?.trim()}`);
    setBusy(false);
    setError(failed);
    if (failed) return;
    setEditing(false);
    // Said after the plain "Saved", so it is the message left on the screen.
    if (replaced) {
      notify(`${name} was booked before, so it is kept at its old price under "No longer offered" and a new one is on offer.`);
    } else if (renamed) {
      notify("Saved. The other languages still have the old wording until they are re-translated.");
    }
  }

  if (editing) {
    return (
      <tr className="border-b border-border bg-primary/5">
        <td colSpan={5} className="px-2 py-4">
          <form onSubmit={save} noValidate className="grid items-start gap-4 sm:grid-cols-2">
            <h3 className="text-base font-bold sm:col-span-2">Change {name}</h3>
            <ServiceFields item={item} kinds={kinds} errors={errors} />
            {item.bookingCount > 0 && (
              <p className="rounded-lg border border-border-strong px-3 py-2 text-sm sm:col-span-2">
                <strong>This service has been booked {times(item.bookingCount)}.</strong> If you change its price or its kind,
                this one is kept exactly as it is and no longer offered, so those requests and visits go on showing the price
                agreed, and a new service with your changes is put on offer in its place. Changing only the name, description or
                time changes this one where it is, including how it reads on those earlier requests.
              </p>
            )}
            <div className="flex flex-col gap-3 sm:col-span-2">
              <ErrorMessage message={error} />
              <div className="flex gap-3">
                <Button type="submit" loading={busy}>
                  Save
                </Button>
                <Button type="button" variant="secondary" disabled={busy} onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-border last:border-0">
      <th scope="row" className="py-2.5 pr-4 text-left align-top font-normal">
        <span className="font-semibold">{name}</span>
        {item.description && <div className="text-muted">{english(item.description)}</div>}
        {item.bookingCount > 0 && <div className="text-muted">Booked {times(item.bookingCount)}</div>}
        {/* Why a service that is "on" is still not bookable. */}
        {item.isActive && kind && !kind.isActive && <div className="text-muted">Not bookable: its kind is switched off.</div>}
        <ErrorMessage message={error} />
      </th>
      <td className="py-2.5 pr-4 align-top">{kind ? english(kind.name) : item.serviceCode}</td>
      <td className="py-2.5 pr-4 align-top">{price(item.pricePaise)}</td>
      <td className="py-2.5 pr-4 align-top">{duration(item.durationMinutes)}</td>
      <td className="py-1.5 align-top">
        <div className="flex flex-wrap justify-end gap-x-1">
          <Button variant="link" disabled={busy} aria-label={`Change ${name}`} onClick={() => setEditing(true)}>
            Change
          </Button>
          <Button
            variant="link"
            loading={busy}
            aria-label={item.isActive ? `Stop offering ${name}` : `Offer ${name} again`}
            onClick={() => void setOffered(!item.isActive)}
          >
            {item.isActive ? "Stop offering" : "Offer again"}
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ───────────────────────── Kinds of service and their tasks ─────────────────────────

function KindCard({
  kind,
  onChange,
  onLoaded,
}: {
  kind: ServiceKindAdminDto;
  onChange: Change;
  /** Puts a catalogue the server sent back on the page without a "saved" message. */
  onLoaded: (catalogue: CatalogAdminDto) => void;
}) {
  const confirm = useConfirm();
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  // Read out by a screen reader after a move, which changes nothing else it would announce.
  const [moved, setMoved] = useState("");

  const name = english(kind.name);
  const inUse = kind.tasks.filter((task) => task.isActive);
  const retired = kind.tasks.filter((task) => !task.isActive);
  const plans = kind.planNames.map((plan) => english(plan));

  async function setActive(isActive: boolean) {
    if (!isActive) {
      const sure = await confirm({
        title: `Switch off ${name}?`,
        body: `Its services come off offer, a visit of this kind can no longer be added, and plans stop creating visits of it${
          plans.length > 0 ? ` (it is part of the ${listed(plans)} plan${plans.length === 1 ? "" : "s"})` : ""
        }. Visits already in the diary stay. Nothing is deleted, and you can switch it back on at any time.`,
        confirmLabel: "Switch it off",
        cancelLabel: "Keep it on",
      });
      if (!sure) return;
    }
    setBusy(true);
    setError(await onChange(() => api.catalogue.updateKind(kind.code, { isActive }), isActive ? `Switched on: ${name}` : `Switched off: ${name}`));
    setBusy(false);
  }

  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formValues(form);
    const found = checkAgainst(updateServiceKindSchema, values);
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);

    const stale = otherLanguages(kind.name).length > 0 && (values.name ?? "").trim() !== name;
    setBusy(true);
    const failed = await onChange(
      () => api.catalogue.updateKind(kind.code, { name: values.name }),
      stale ? "Saved. The other languages still have the old wording until they are re-translated." : `Saved: ${values.name?.trim()}`,
    );
    setBusy(false);
    setError(failed);
    if (!failed) setRenaming(false);
  }

  async function move(task: ServiceTaskAdminDto, direction: "up" | "down") {
    const index = inUse.indexOf(task);
    const place = direction === "up" ? index : index + 2;
    setError(null);
    try {
      // Not through `onChange`: a "saved" message for every step up a list would be noise.
      onLoaded(await api.catalogue.moveTask(task.id, { direction }));
      setMoved(`${english(task.label)} is now number ${place} of ${inUse.length}.`);
      // The row has moved, and its button with it; put the keyboard back on it so it can be moved again.
      // At the top or bottom that button is switched off, so the other one takes the cursor.
      requestAnimationFrame(() => {
        const button = (way: string) => document.getElementById(`move-${way}-${task.id}`) as HTMLButtonElement | null;
        const same = button(direction);
        (same && !same.disabled ? same : button(direction === "up" ? "down" : "up"))?.focus();
      });
    } catch (e) {
      setError(describe(e));
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div>
          <h3 className="flex flex-wrap items-center gap-2 text-lg font-bold">
            {name}
            {!kind.isActive && <Tag>Switched off</Tag>}
          </h3>
          <p className="text-sm text-muted">
            {kind.visitCount === 0 ? "No visits yet" : `${kind.visitCount} visit${kind.visitCount === 1 ? "" : "s"} on record`}
            {plans.length > 0 && ` · in the ${listed(plans)} plan${plans.length === 1 ? "" : "s"}`}
          </p>
        </div>
        {!renaming && (
          <div className="flex flex-wrap gap-x-1">
            <Button variant="link" disabled={busy} aria-label={`Rename ${name}`} onClick={() => setRenaming(true)}>
              Rename
            </Button>
            <Button
              variant="link"
              loading={busy}
              aria-label={kind.isActive ? `Switch off ${name}` : `Switch ${name} back on`}
              onClick={() => void setActive(!kind.isActive)}
            >
              {kind.isActive ? "Switch off" : "Switch back on"}
            </Button>
          </div>
        )}
      </div>

      {renaming && (
        <form onSubmit={rename} noValidate className="flex max-w-xl flex-col gap-3">
          <Field
            label="Name of this kind of service, in English"
            name="name"
            required
            maxLength={120}
            autoFocus
            defaultValue={name}
            hint={translationHint(kind.name)}
            error={errors.name}
          />
          <div className="flex gap-3">
            <Button type="submit" loading={busy}>
              Save
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setRenaming(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      <ErrorMessage message={error} />

      <KindCertificate kind={kind} onChange={onChange} />
      <KindTax kind={kind} onChange={onChange} />

      {inUse.length === 0 ? (
        <p className="text-muted">
          No tasks yet. A visit of this kind has nothing to tick: the Supervisor finishes it with photos and notes alone. Add the
          first task below.
        </p>
      ) : (
        <ol className="flex flex-col">
          {inUse.map((task, index) => (
            <TaskRow
              key={task.id}
              task={task}
              number={index + 1}
              isFirst={index === 0}
              isLast={index === inUse.length - 1}
              onMove={move}
              onChange={onChange}
            />
          ))}
        </ol>
      )}
      <p role="status" className="sr-only">
        {moved}
      </p>

      <AddTaskForm kind={kind} onChange={onChange} />

      {retired.length > 0 && (
        <details>
          <summary className="cursor-pointer rounded-md py-1 text-sm font-semibold text-primary">Retired tasks ({retired.length})</summary>
          <p className="mt-1 text-sm text-muted">Not asked on new visits. Visits that answered them still show them.</p>
          <ul className="flex flex-col">
            {retired.map((task) => (
              <RetiredTaskRow key={task.id} task={task} onChange={onChange} />
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

// What to say beside the tax boxes, wherever they appear.
const TAX_CODE_HINT =
  "The GST code printed on its invoices: an SAC for a service (6 digits starting 99, for example 998533 for specialised cleaning) or an HSN for goods you sell (4, 6 or 8 digits, for example 3402 for cleaning chemicals). Ask your accountant if unsure.";
const TAX_RATE_HINT = "In percent, figures only. Most services are 18. Enter 0 for a service that is exempt.";
const PARTNER_HINT =
  "Choose yes when a lab, clinic, training partner or audit agency does part of it. The app then says so, and the visit asks which partner did it and for their result document.";

/** The heading, tax code, tax rate and partner boxes, shared by adding a kind and changing one. */
function KindTaxFields({ kind, errors }: { kind?: ServiceKindAdminDto; errors: FieldErrors }) {
  return (
    <>
      <SelectField
        label="Listed under"
        name="category"
        defaultValue={kind?.category ?? ""}
        hint="The heading restaurants see it under when booking in the app."
        error={errors.category}
      >
        {!kind && <option value="">Choose a heading</option>}
        {SERVICE_CATEGORIES.map((category) => (
          <option key={category} value={category}>
            {SERVICE_CATEGORY_ENGLISH[category]}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Does a partner deliver part of it?"
        name="partnerDelivered"
        defaultValue={kind?.partnerDelivered ? "yes" : "no"}
        hint={PARTNER_HINT}
      >
        <option value="no">No, ECCS does all of it</option>
        <option value="yes">Yes, with an outside partner</option>
      </SelectField>
      <Field
        label="SAC or HSN code"
        name="sacCode"
        required
        inputMode="numeric"
        maxLength={8}
        defaultValue={kind?.sacCode ?? ""}
        hint={TAX_CODE_HINT}
        error={errors.sacCode}
      />
      <Field
        label="GST rate, in percent"
        name="gstRatePercent"
        required
        inputMode="decimal"
        maxLength={5}
        defaultValue={kind ? String(kind.gstRatePercent) : "18"}
        hint={TAX_RATE_HINT}
        error={errors.gstRatePercent}
      />
    </>
  );
}

/**
 * Adds a brand-new kind of service. It needs its tax code and rate at once,
 * because the first approved visit of it is invoiced with them. Its task list
 * and its bookable services are added afterwards, in its own card below and in
 * the table above, so nothing reaches restaurants until those exist.
 */
function AddKindForm({ kinds, onChange, onClose }: { kinds: ServiceKindAdminDto[]; onChange: Change; onClose: () => void }) {
  const [issues, setIssues] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const typed = formValues(form);
    const values = {
      name: typed.name ?? "",
      category: typed.category as (typeof SERVICE_CATEGORIES)[number],
      sacCode: typed.sacCode ?? "",
      gstRatePercent: typed.gstRatePercent,
      partnerDelivered: typed.partnerDelivered === "yes",
      issuesCertificate: issues,
      ...(issues && { certificateValidDays: typed.certificateValidDays }),
    };
    const found = checkAgainst(createServiceKindSchema, values);
    // Said here rather than after a round trip: the same name would give the same code.
    const code = serviceCodeFromName(values.name);
    const taken = kinds.some((kind) => kind.code === code || english(kind.name).toLowerCase() === values.name.trim().toLowerCase());
    if (!found.name && taken) found.name = "There is already a kind of service with that name.";
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);

    setBusy(true);
    const failed = await onChange(
      () => api.catalogue.addKind(values),
      `Added: ${values.name.trim()}. Now add its tasks, then a service restaurants can book.`,
    );
    setBusy(false);
    setError(failed);
    if (!failed) onClose();
  }

  return (
    <Card>
      <form onSubmit={submit} noValidate className="grid items-start gap-4 sm:grid-cols-2">
        <h3 className="text-base font-bold sm:col-span-2">Add a kind of service</h3>
        <Field
          label="Name of this kind of service, in English"
          name="name"
          required
          maxLength={120}
          autoFocus
          hint="For example: Water tank cleaning. It shows in English to everyone until it is translated."
          error={errors.name}
          wrapperClassName="sm:col-span-2"
        />
        <KindTaxFields errors={errors} />
        <SelectField
          label="Does a visit of this kind end with a certificate?"
          name="issuesCertificate"
          value={issues ? "yes" : "no"}
          onChange={(e) => setIssues(e.target.value === "yes")}
          hint="An ECCS certificate of service, for ECCS's own work. Choose no where an outside body certifies (a lab report, a medical or training certificate, an FSSAI rating): attach their document to the visit instead."
        >
          <option value="no">No certificate</option>
          <option value="yes">Yes, issue a certificate</option>
        </SelectField>
        {issues && (
          <Field
            label="Valid for how many days?"
            name="certificateValidDays"
            required
            inputMode="numeric"
            maxLength={4}
            hint="Counted from the day of the visit."
            error={errors.certificateValidDays}
          />
        )}
        <p className="text-sm text-muted sm:col-span-2">
          Restaurants see nothing new yet. After adding the kind, give it its tasks in its card below, then add a service of this
          kind, with its price and description, under Services restaurants can book. A kind cannot be deleted afterwards, only
          switched off.
        </p>
        <div className="flex flex-col gap-3 sm:col-span-2">
          <ErrorMessage message={error} />
          <div className="flex gap-3">
            <Button type="submit" loading={busy}>
              Add the kind of service
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

/**
 * The heading a kind is listed under, its GST code and rate, and whether a
 * partner delivers part of it. Shown as one line; "Change" opens the boxes.
 * A new code or rate applies to invoices raised from then on: an invoice
 * already issued keeps the code and rate it was issued with.
 */
function KindTax({ kind, onChange }: { kind: ServiceKindAdminDto; onChange: Change }) {
  const name = english(kind.name);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const typed = formValues(form);
    const values = {
      category: typed.category as (typeof SERVICE_CATEGORIES)[number],
      sacCode: typed.sacCode ?? "",
      gstRatePercent: typed.gstRatePercent ?? "",
      partnerDelivered: typed.partnerDelivered === "yes",
    };
    const found = checkAgainst(updateServiceKindSchema, values);
    if (!values.gstRatePercent.trim()) found.gstRatePercent = "Enter the GST rate in figures, for example 18.";
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);

    setBusy(true);
    const failed = await onChange(
      () => api.catalogue.updateKind(kind.code, values),
      `Saved: ${name}. Invoices from now on use code ${values.sacCode} at ${Number(values.gstRatePercent)}%.`,
    );
    setBusy(false);
    setError(failed);
    if (!failed) setEditing(false);
  }

  if (!editing) {
    return (
      <p className="flex flex-wrap items-center gap-x-1 text-sm">
        <span className="font-semibold">Listed under:</span>
        <span>{SERVICE_CATEGORY_ENGLISH[kind.category]}</span>
        <span className="font-semibold">· GST:</span>
        <span>
          code {kind.sacCode} at {kind.gstRatePercent}%
        </span>
        {kind.partnerDelivered && <span>· delivered with a partner</span>}
        <Button
          variant="link"
          aria-label={`Change the heading and tax code of ${name}`}
          onClick={() => {
            setError(null);
            setErrors({});
            setEditing(true);
          }}
        >
          Change
        </Button>
      </p>
    );
  }

  return (
    <form
      onSubmit={save}
      noValidate
      aria-label={`Heading and tax code of ${name}`}
      className="grid items-start gap-3 rounded-lg border border-primary p-3 sm:grid-cols-2"
    >
      <KindTaxFields kind={kind} errors={errors} />
      <p className="text-sm text-muted sm:col-span-2">
        A new code or rate is used on invoices raised from now on. Invoices already issued keep theirs.
      </p>
      <div className="flex flex-col gap-3 sm:col-span-2">
        <ErrorMessage message={error} />
        <div className="flex gap-3">
          <Button type="submit" loading={busy}>
            Save
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}

/**
 * Whether a visit of this kind ends with a certificate for the restaurant, and
 * for how many days it is valid. Shown as one line; "Change" opens the two boxes.
 * A change applies to reports approved from then on: certificates already
 * issued keep the dates they were given.
 */
function KindCertificate({ kind, onChange }: { kind: ServiceKindAdminDto; onChange: Change }) {
  const name = english(kind.name);
  const [editing, setEditing] = useState(false);
  const [issues, setIssues] = useState(kind.issuesCertificate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  function open() {
    setIssues(kind.issuesCertificate);
    setError(null);
    setErrors({});
    setEditing(true);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const days = formValues(form).certificateValidDays ?? "";
    // When certificates are switched off the number of days is left as it was, for switching back on later.
    const values = issues ? { issuesCertificate: true, certificateValidDays: days } : { issuesCertificate: false };
    const found = checkAgainst(updateServiceKindSchema, values);
    if (issues && !days.trim()) found.certificateValidDays = "Enter how many days the certificate is valid for.";
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);

    setBusy(true);
    const failed = await onChange(
      () => api.catalogue.updateKind(kind.code, values),
      issues ? `Saved: ${name} certificates are valid for ${Number(days)} days` : `Saved: ${name} visits no longer issue a certificate`,
    );
    setBusy(false);
    setError(failed);
    if (!failed) setEditing(false);
  }

  if (!editing) {
    return (
      <p className="flex flex-wrap items-center gap-x-1 text-sm">
        <span className="font-semibold">Certificate:</span>
        <span>
          {kind.issuesCertificate && kind.certificateValidDays
            ? `issued when the report is approved, valid for ${kind.certificateValidDays} day${kind.certificateValidDays === 1 ? "" : "s"}`
            : "none for this kind of service"}
          {kind.certificateCount > 0 && <span className="text-muted"> · {kind.certificateCount} issued so far</span>}
        </span>
        <Button variant="link" aria-label={`Change the certificate of ${name}`} onClick={open}>
          Change
        </Button>
      </p>
    );
  }

  return (
    <form onSubmit={save} noValidate aria-label={`Certificate of ${name}`} className="flex max-w-xl flex-col gap-3 rounded-lg border border-primary p-3">
      <SelectField
        label="Does a visit of this kind end with a certificate?"
        name="issuesCertificate"
        value={issues ? "yes" : "no"}
        onChange={(e) => setIssues(e.target.value === "yes")}
        hint="It is issued by itself when ECCS approves the visit's report, and filed in the outlet's documents."
      >
        <option value="yes">Yes, issue a certificate</option>
        <option value="no">No certificate</option>
      </SelectField>
      {issues && (
        <Field
          label="Valid for how many days?"
          name="certificateValidDays"
          required
          inputMode="numeric"
          maxLength={4}
          defaultValue={kind.certificateValidDays ?? ""}
          hint="Counted from the day of the visit. Certificates already issued keep their dates."
          error={errors.certificateValidDays}
          wrapperClassName="max-w-xs"
        />
      )}
      <ErrorMessage message={error} />
      <div className="flex gap-3">
        <Button type="submit" loading={busy}>
          Save
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * One task in use. It is moved with Up and Down buttons, which work the same
 * with a mouse, a keyboard and a screen reader (dragging does not); the first
 * task cannot go up and the last cannot go down.
 */
function TaskRow({
  task,
  number,
  isFirst,
  isLast,
  onMove,
  onChange,
}: {
  task: ServiceTaskAdminDto;
  number: number;
  isFirst: boolean;
  isLast: boolean;
  onMove: (task: ServiceTaskAdminDto, direction: "up" | "down") => Promise<void>;
  onChange: Change;
}) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const label = english(task.label);

  async function step(direction: "up" | "down") {
    setBusy(true);
    await onMove(task, direction);
    setBusy(false);
  }

  async function retire() {
    const sure = await confirm({
      title: "Retire this task?",
      body: `"${label}" will no longer be asked on new visits${
        task.answerCount > 0 ? `. The ${task.answerCount} visit${task.answerCount === 1 ? "" : "s"} that answered it keep${task.answerCount === 1 ? "s" : ""} showing it` : ""
      }. You can bring it back at any time under Retired tasks.`,
      confirmLabel: "Retire the task",
      cancelLabel: "Keep the task",
    });
    if (!sure) return;
    setBusy(true);
    setError(await onChange(() => api.catalogue.updateTask(task.id, { isActive: false }), `Retired: ${label}`));
    setBusy(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formValues(form);
    const found = checkAgainst(updateServiceTaskSchema, values);
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);

    const stale = otherLanguages(task.label).length > 0 && (values.label ?? "").trim() !== label;
    setBusy(true);
    const failed = await onChange(
      () => api.catalogue.updateTask(task.id, { label: values.label }),
      stale ? "Saved. The other languages still have the old wording until they are re-translated." : "Task saved",
    );
    setBusy(false);
    setError(failed);
    if (!failed) setEditing(false);
  }

  return (
    <li className="flex flex-col gap-2 border-b border-border py-2 last:border-0">
      {editing ? (
        <form onSubmit={save} noValidate className="flex max-w-2xl flex-col gap-3">
          <Field
            label={`Task ${number}, in English`}
            name="label"
            required
            maxLength={200}
            autoFocus
            defaultValue={label}
            hint={`${translationHint(task.label)}${
              task.answerCount > 0 ? ` The new wording also shows on the ${task.answerCount} visit${task.answerCount === 1 ? "" : "s"} that answered it.` : ""
            }`}
            error={errors.label}
          />
          <div className="flex gap-3">
            <Button type="submit" loading={busy}>
              Save
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <span>
            <span className="mr-2 text-muted">{number}.</span>
            {label}
            {/* A task that records a meter reading instead of a tick (the frying oil test). */}
            {task.readingLimit !== null && (
              <span className="ml-2">
                <Tag>{`Records a reading, limit ${task.readingLimit}`}</Tag>
              </span>
            )}
          </span>
          <div className="flex flex-wrap gap-x-1">
            <Button
              id={`move-up-${task.id}`}
              variant="link"
              disabled={busy || isFirst}
              aria-label={`Move up: ${label}`}
              onClick={() => void step("up")}
            >
              <span aria-hidden>↑ </span>Up
            </Button>
            <Button
              id={`move-down-${task.id}`}
              variant="link"
              disabled={busy || isLast}
              aria-label={`Move down: ${label}`}
              onClick={() => void step("down")}
            >
              <span aria-hidden>↓ </span>Down
            </Button>
            <Button variant="link" disabled={busy} aria-label={`Reword: ${label}`} onClick={() => setEditing(true)}>
              Reword
            </Button>
            <Button variant="link" disabled={busy} aria-label={`Retire: ${label}`} onClick={() => void retire()}>
              Retire
            </Button>
          </div>
        </div>
      )}
      <ErrorMessage message={error} />
    </li>
  );
}

function RetiredTaskRow({ task, onChange }: { task: ServiceTaskAdminDto; onChange: Change }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = english(task.label);

  async function bringBack() {
    setBusy(true);
    setError(await onChange(() => api.catalogue.updateTask(task.id, { isActive: true }), `Back in use: ${label}`));
    setBusy(false);
  }

  return (
    <li className="flex flex-col gap-2 border-b border-border py-2 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="text-muted">
          {label}
          {task.answerCount > 0 && ` · answered on ${task.answerCount} visit${task.answerCount === 1 ? "" : "s"}`}
        </span>
        <Button variant="link" loading={busy} aria-label={`Bring back: ${label}`} onClick={() => void bringBack()}>
          Bring back
        </Button>
      </div>
      <ErrorMessage message={error} />
    </li>
  );
}

/** Adds a task to the end of the list; it is then moved up to where it belongs. */
function AddTaskForm({ kind, onChange }: { kind: ServiceKindAdminDto; onChange: Change }) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const found = checkAgainst(addServiceTaskSchema, { label });
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);

    setBusy(true);
    const failed = await onChange(() => api.catalogue.addTask(kind.code, { label }), `Task added to ${english(kind.name)}`);
    setBusy(false);
    setError(failed);
    if (!failed) setLabel("");
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-2xl flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <Field
          label={`Add a task to ${english(kind.name)}, in English`}
          name="label"
          plainLabel
          maxLength={200}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          hint="Say what is done, for example: Drains cleared and flushed. It goes at the end of the list and shows in English to everyone until translated."
          error={errors.label}
          wrapperClassName="min-w-0 flex-1 basis-80"
        />
        <Button type="submit" variant="secondary" loading={busy}>
          Add task
        </Button>
      </div>
      <ErrorMessage message={error} />
    </form>
  );
}
