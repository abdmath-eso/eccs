"use client";

import {
  updateOrganizationSchema,
  updateOutletSchema,
  updateOwnerSchema,
  type LinkedPhoneDto,
  type OrganizationDto,
} from "@eccs/shared";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { Button, Code, ErrorMessage, Field, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { checkAgainst, focusFirstError, formValues, hasErrors, type FieldErrors } from "@/lib/forms";
import { describe, when } from "@/lib/format";

// Changing a client after onboarding, for the Clients page: its details, its
// Owner, each outlet's details and restaurant code, the phones linked to it,
// and switching an outlet or the whole client off and on.
//
// The layout follows the usual "summary with Change links" pattern: what is on
// record is shown as it stands, and Change opens a short form in the same
// place. Nothing is deleted anywhere here. Visits, reports, licences and
// invoices hang off a client and its outlets, so they are switched off
// instead, which is undone with one click.

type Outlet = OrganizationDto["outlets"][number];
type Owner = OrganizationDto["owners"][number];

/** Every change answers with the whole client as it now stands. */
type OnChanged = (client: OrganizationDto) => void;

/** A word saying where something stands, in a box so it does not rely on colour. */
export function Tag({ children }: { children: string }) {
  return <span className="rounded-md border border-border-strong px-1.5 py-0.5 text-xs font-semibold text-muted">{children}</span>;
}

/** One line of a summary: what it is, and what is on record ("Not given" when empty). */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children || <span className="text-muted">Not given</span>}</dd>
    </div>
  );
}

function FormButtons({ busy, onCancel, save = "Save" }: { busy: boolean; onCancel: () => void; save?: string }) {
  return (
    <div className="flex gap-3">
      <Button type="submit" loading={busy}>
        {save}
      </Button>
      <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

/**
 * The phones linked to one client, fetched when its row is opened. `phones`
 * is null until they have loaded.
 */
export function useLinkedPhones(clientId: string) {
  const [phones, setPhones] = useState<LinkedPhoneDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.clients
      .phones(clientId)
      .then((list) => {
        if (cancelled) return;
        setPhones(list);
        setError(null);
      })
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [clientId, attempt]);

  return { phones, error, setPhones, retry: () => setAttempt((current) => current + 1) };
}

export type LinkedPhones = ReturnType<typeof useLinkedPhones>;

// ───────────────────────── The client itself ─────────────────────────

/** The client's name, legal name and GSTIN with a Change link, and switching the whole client off or on. */
export function ClientSummary({ client, onChanged }: { client: OrganizationDto; onChanged: OnChanged }) {
  const confirm = useConfirm();
  const notify = useToast();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formValues(form);
    const found = checkAgainst(updateOrganizationSchema, values);
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);

    setBusy(true);
    setError(null);
    try {
      onChanged(await api.clients.update(client.id, { name: values.name, legalName: values.legalName, gstin: values.gstin }));
      setEditing(false);
      notify("Client details saved");
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  async function setActive(isActive: boolean) {
    if (!isActive) {
      const sure = await confirm({
        title: `Switch off ${client.name}?`,
        body: "Nobody at any of its outlets will be able to log in, the Owner included; its restaurant codes will link no phones; and it will take no bookings, visits or plan visits. Visits already in the diary are not cancelled: cancel them in Visits if they should not happen. Nothing is deleted, and you can switch the client back on at any time.",
        confirmLabel: "Switch the client off",
        cancelLabel: "Keep it on",
      });
      if (!sure) return;
    }
    setBusy(true);
    setError(null);
    try {
      onChanged(await api.clients.update(client.id, { isActive }));
      notify(isActive ? `${client.name} is switched back on` : `${client.name} is switched off`);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {!client.isActive && (
        <p className="rounded-lg border border-border-strong bg-surface px-3 py-2">
          <strong>This client is switched off.</strong> Nobody at its outlets can log in, its restaurant codes link no phones, and
          it takes no bookings, visits or plan visits. Everything on record is kept.
        </p>
      )}

      {editing ? (
        <form onSubmit={save} noValidate className="grid items-start gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3">
          <h3 className="text-base font-bold sm:col-span-3">Change the client&apos;s details</h3>
          <Field label="Restaurant (brand) name" name="name" required maxLength={120} autoFocus defaultValue={client.name} error={errors.name} />
          <Field
            label="Legal name"
            name="legalName"
            maxLength={160}
            defaultValue={client.legalName ?? ""}
            hint="The registered name, as it goes on invoices."
            error={errors.legalName}
          />
          <Field
            label="GSTIN"
            name="gstin"
            maxLength={15}
            autoCapitalize="characters"
            defaultValue={client.gstin ?? ""}
            hint="15 characters, for example 36ABCDE1234F1Z5."
            error={errors.gstin}
          />
          <div className="flex flex-col gap-3 sm:col-span-3">
            <ErrorMessage message={error} />
            <FormButtons busy={busy} onCancel={() => setEditing(false)} />
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1">
          <dl className="flex flex-col gap-0.5">
            <Fact label="Name">{client.name}</Fact>
            <Fact label="Legal name">{client.legalName}</Fact>
            <Fact label="GSTIN">{client.gstin}</Fact>
          </dl>
          <div className="flex flex-wrap gap-x-1">
            <Button variant="link" disabled={busy} aria-label={`Change the details of ${client.name}`} onClick={() => setEditing(true)}>
              Change details
            </Button>
            <Button variant="link" loading={busy} onClick={() => void setActive(!client.isActive)}>
              {client.isActive ? "Switch off this client" : "Switch this client back on"}
            </Button>
          </div>
        </div>
      )}
      {!editing && <ErrorMessage message={error} />}
    </div>
  );
}

// ───────────────────────── The Owner ─────────────────────────

/**
 * One Owner: their contact details with a Change link, the phones they
 * linked with their one-time code, and help for a lost PIN.
 */
export function OwnerSummary({
  client,
  owner,
  linked,
  onChanged,
}: {
  client: OrganizationDto;
  owner: Owner;
  linked: LinkedPhones;
  onChanged: OnChanged;
}) {
  const confirm = useConfirm();
  const notify = useToast();
  const [editing, setEditing] = useState(false);
  const [showPhones, setShowPhones] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  // A phone linked by an Owner's one-time code belongs to the client, not to an outlet.
  const ownPhones = linked.phones?.filter((phone) => phone.outletId === null) ?? null;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formValues(form);
    const found = checkAgainst(updateOwnerSchema, values);
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);

    setBusy(true);
    setError(null);
    try {
      onChanged(await api.clients.updateOwner(client.id, owner.id, { name: values.name, phone: values.phone ?? "", email: values.email }));
      setEditing(false);
      notify("Owner's details saved");
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  async function resetSetup() {
    const sure = await confirm({
      title: `Remove ${owner.name}'s PIN so they can set up again?`,
      body: `Their PIN stops working and they are logged out everywhere. To get a new PIN they open the ECCS app, tap "I am the owner", and enter ${owner.phone ?? "their mobile number"} and the one-time code sent to it; the app then shows them the new PIN. Nobody else's PIN changes.`,
      confirmLabel: "Remove the PIN",
      cancelLabel: "Keep the PIN",
    });
    if (!sure) return;
    setBusy(true);
    setError(null);
    try {
      onChanged(await api.clients.resetOwnerSetup(client.id, owner.id));
      notify(`${owner.name} can now set up again with their mobile number`);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <form onSubmit={save} noValidate className="grid items-start gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3">
        <h3 className="text-base font-bold sm:col-span-3">Change the Owner&apos;s details</h3>
        <Field label="Owner's name" name="name" required maxLength={100} autoFocus defaultValue={owner.name} error={errors.name} />
        <Field
          label="Owner's mobile number"
          name="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          required
          defaultValue={owner.phone?.replace(/^\+91/, "") ?? ""}
          hint="10 digits. Their one-time code is sent here, so a wrong number locks them out of setting up."
          error={errors.phone}
        />
        <Field label="Owner's email" name="email" type="email" autoComplete="off" defaultValue={owner.email ?? ""} error={errors.email} />
        <p className="text-sm text-muted sm:col-span-3">
          Changing the number does not change their PIN or log them out. It changes where the one-time code goes the next time
          they set up a phone or reset their PIN.
        </p>
        <div className="flex flex-col gap-3 sm:col-span-3">
          <ErrorMessage message={error} />
          <FormButtons busy={busy} onCancel={() => setEditing(false)} />
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1">
        <dl className="flex flex-col gap-0.5">
          <Fact label="Owner">{owner.name}</Fact>
          <Fact label="Mobile">{owner.phone}</Fact>
          <Fact label="Email">{owner.email}</Fact>
          <Fact label="PIN">
            {owner.hasPin ? "Set" : <span className="font-semibold text-danger">Not set yet: they have not been through set-up in the app</span>}
          </Fact>
        </dl>
        <div className="flex flex-wrap gap-x-1">
          <Button variant="link" disabled={busy} aria-label={`Change the details of ${owner.name}`} onClick={() => setEditing(true)}>
            Change details
          </Button>
          <Button variant="link" aria-expanded={showPhones} onClick={() => setShowPhones((current) => !current)}>
            Their phones{ownPhones ? ` (${ownPhones.length})` : ""}
          </Button>
          {/* Only offered when there is a PIN to lose. Without one they are already at the first-time set-up. */}
          {owner.hasPin && (
            <Button variant="link" loading={busy} onClick={() => void resetSetup()}>
              Lost PIN: set up again
            </Button>
          )}
        </div>
      </div>
      <ErrorMessage message={error} />
      {showPhones && (
        <PhoneList
          client={client}
          linked={linked}
          phones={ownPhones}
          none="No phone has been set up with the Owner's mobile number and one-time code."
          about="Phones set up with an Owner's mobile number and one-time code. Any PIN of this client works on them."
        />
      )}
    </div>
  );
}

// ───────────────────────── Linked phones ─────────────────────────

function PhoneList({
  client,
  linked,
  phones,
  none,
  about,
}: {
  client: OrganizationDto;
  linked: LinkedPhones;
  /** The phones to show, already narrowed to one outlet or to the Owner's; null while loading. */
  phones: LinkedPhoneDto[] | null;
  none: string;
  about: string;
}) {
  const confirm = useConfirm();
  const notify = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function unlink(phone: LinkedPhoneDto) {
    const sure = await confirm({
      title: `Unlink ${phone.name ?? "this phone"}?`,
      body: "Anyone logged in on it is logged out, and it must be linked again with the restaurant code before a PIN works on it. Nobody's PIN changes. If the code itself has got out, issue a new restaurant code as well.",
      confirmLabel: "Unlink the phone",
      cancelLabel: "Keep it linked",
    });
    if (!sure) return;
    setBusyId(phone.id);
    setError(null);
    try {
      linked.setPhones(await api.clients.unlinkPhone(client.id, phone.id));
      notify("Phone unlinked");
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusyId(null);
    }
  }

  if (linked.error) {
    return (
      <div className="flex flex-col items-start gap-2">
        <ErrorMessage message={`The linked phones could not be loaded. ${linked.error}`} />
        <Button variant="secondary" onClick={linked.retry}>
          Try again
        </Button>
      </div>
    );
  }
  if (!phones) return <Loading className="text-sm">Loading the linked phones…</Loading>;

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3 text-sm">
      <p className="text-muted">{about}</p>
      {phones.length === 0 ? (
        <p>{none}</p>
      ) : (
        <ul className="flex flex-col">
          {phones.map((phone) => (
            <li key={phone.id} className="flex flex-wrap items-center justify-between gap-x-4 border-b border-border py-1 last:border-0">
              <span>
                <span className="font-medium">{phone.name ?? "Phone (no name given)"}</span>
                <span className="text-muted">
                  {" "}
                  · linked {when(phone.linkedAt)} · last used {when(phone.lastUsedAt)}
                </span>
              </span>
              <Button
                variant="link"
                loading={busyId === phone.id}
                disabled={busyId !== null}
                aria-label={`Unlink ${phone.name ?? "phone"} linked ${when(phone.linkedAt)}`}
                onClick={() => void unlink(phone)}
              >
                Unlink
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ErrorMessage message={error} />
    </div>
  );
}

// ───────────────────────── One outlet ─────────────────────────

/**
 * What can be done to one outlet, shown under its row: change its details,
 * issue a new restaurant code, see and unlink its phones, switch it off or on.
 */
export function OutletEditing({
  client,
  outlet,
  linked,
  onChanged,
}: {
  client: OrganizationDto;
  outlet: Outlet;
  linked: LinkedPhones;
  onChanged: OnChanged;
}) {
  const confirm = useConfirm();
  const notify = useToast();
  const [editing, setEditing] = useState(false);
  const [showPhones, setShowPhones] = useState(false);
  const [busy, setBusy] = useState<"save" | "code" | "active" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  /** The code just issued, kept on show until dismissed so it can be read out to the Owner. */
  const [newCode, setNewCode] = useState<string | null>(null);

  const phones = linked.phones?.filter((phone) => phone.outletId === outlet.id) ?? null;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formValues(form);
    const found = checkAgainst(updateOutletSchema, values);
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);

    setBusy("save");
    setError(null);
    try {
      onChanged(
        await api.clients.updateOutlet(client.id, outlet.id, {
          name: values.name,
          address: values.address,
          city: values.city,
          pincode: values.pincode,
          fssaiNumber: values.fssaiNumber,
        }),
      );
      setEditing(false);
      notify("Outlet details saved");
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  async function issueCode() {
    const count = phones?.length ?? 0;
    const sure = await confirm({
      title: `Issue a new restaurant code for ${outlet.name}?`,
      body: `The code ${outlet.code} stops working at once: nobody can link a new phone with it. ${
        count > 0 ? `The ${count} phone${count === 1 ? "" : "s"} already linked stay linked and keep working` : "Phones already linked stay linked and keep working"
      }; unlink any that should not be, under Linked phones. You will need to give the new code to the Owner and Manager.`,
      confirmLabel: "Issue a new code",
      cancelLabel: "Keep this code",
    });
    if (!sure) return;
    setBusy("code");
    setError(null);
    try {
      const next = await api.clients.newOutletCode(client.id, outlet.id);
      onChanged(next);
      setNewCode(next.outlets.find((entry) => entry.id === outlet.id)?.code ?? null);
      notify(`New restaurant code issued for ${outlet.name}`);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  async function setActive(isActive: boolean) {
    if (!isActive) {
      // How many visits are still to come, so the question can say they are not cancelled. Left out if it cannot be read.
      const upcoming = await api.visits
        .list({ outletId: outlet.id, state: "open" })
        .then((visits) => visits.filter((visit) => visit.status === "SCHEDULED" || visit.status === "ASSIGNED").length)
        .catch(() => 0);
      const sure = await confirm({
        title: `Switch off ${outlet.name}?`,
        body: `Its Manager and Head Chefs are logged out and cannot log in, its restaurant code links no phones, and it takes no bookings, visits or plan visits. The Owner can still log in but no longer sees this outlet. ${
          upcoming > 0
            ? `${upcoming} visit${upcoming === 1 ? "" : "s"} already in the diary ${upcoming === 1 ? "is" : "are"} not cancelled: cancel ${upcoming === 1 ? "it" : "them"} in Visits if ${upcoming === 1 ? "it" : "they"} should not happen. `
            : ""
        }Nothing is deleted, and you can switch it back on at any time.`,
        confirmLabel: "Switch the outlet off",
        cancelLabel: "Keep it on",
      });
      if (!sure) return;
    }
    setBusy("active");
    setError(null);
    try {
      onChanged(await api.clients.updateOutlet(client.id, outlet.id, { isActive }));
      notify(isActive ? `${outlet.name} is switched back on` : `${outlet.name} is switched off`);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  if (editing) {
    return (
      <form onSubmit={save} noValidate className="grid items-start gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3">
        <h3 className="text-base font-bold sm:col-span-3">Change the details of {outlet.name}</h3>
        <Field label="Outlet name" name="name" required maxLength={120} autoFocus defaultValue={outlet.name} error={errors.name} />
        <Field label="Address" name="address" required maxLength={300} defaultValue={outlet.address} wrapperClassName="sm:col-span-2" error={errors.address} />
        <Field label="City" name="city" required maxLength={80} defaultValue={outlet.city} error={errors.city} />
        <Field
          label="PIN code"
          name="pincode"
          inputMode="numeric"
          maxLength={6}
          defaultValue={outlet.pincode ?? ""}
          hint="6 digits."
          error={errors.pincode}
        />
        <Field label="FSSAI licence number" name="fssaiNumber" maxLength={20} defaultValue={outlet.fssaiNumber ?? ""} error={errors.fssaiNumber} />
        <p className="text-sm text-muted sm:col-span-3">
          The new details show on reports made from now on. Report PDFs already made keep the details they were made with. The
          restaurant code does not change with the name.
        </p>
        <div className="flex flex-col gap-3 sm:col-span-3">
          <ErrorMessage message={error} />
          <FormButtons busy={busy === "save"} onCancel={() => setEditing(false)} />
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      {!outlet.isActive && (
        <p className="text-muted">
          Switched off: its Manager and Head Chefs cannot log in, its code links no phones, and it takes no bookings, visits or
          plan visits. Everything on record is kept.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-1">
        <Button variant="link" className="-ml-2" disabled={busy !== null} aria-label={`Change the details of ${outlet.name}`} onClick={() => setEditing(true)}>
          Change details
        </Button>
        <Button variant="link" loading={busy === "code"} disabled={busy !== null} aria-label={`Issue a new restaurant code for ${outlet.name}`} onClick={() => void issueCode()}>
          New restaurant code
        </Button>
        <Button
          variant="link"
          aria-expanded={showPhones}
          aria-label={`Linked phones of ${outlet.name}${phones ? `: ${phones.length}` : ""}`}
          onClick={() => setShowPhones((current) => !current)}
        >
          Linked phones{phones ? ` (${phones.length})` : ""}
        </Button>
        <Button
          variant="link"
          loading={busy === "active"}
          disabled={busy !== null}
          aria-label={outlet.isActive ? `Switch off ${outlet.name}` : `Switch ${outlet.name} back on`}
          onClick={() => void setActive(!outlet.isActive)}
        >
          {outlet.isActive ? "Switch off" : "Switch back on"}
        </Button>
      </div>
      <ErrorMessage message={error} />

      {newCode && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary bg-primary/5 px-3 py-2">
          <p>
            The new restaurant code for {outlet.name} is <Code>{newCode}</Code>. Give it to the Owner and Manager: new phones are
            linked with it from now on.
          </p>
          <Button variant="secondary" onClick={() => setNewCode(null)}>
            Done
          </Button>
        </div>
      )}

      {showPhones && (
        <PhoneList
          client={client}
          linked={linked}
          phones={phones}
          none="No phone is linked with this outlet's restaurant code."
          about="Phones on which someone typed this outlet's restaurant code. Each stays linked until it is unlinked here, even after a new code is issued."
        />
      )}
    </div>
  );
}
