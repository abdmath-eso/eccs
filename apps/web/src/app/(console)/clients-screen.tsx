"use client";

import { can, createOrganizationSchema, createOutletSchema, type OrganizationDto } from "@eccs/shared";
import { Fragment, useEffect, useState, type FormEvent } from "react";

import { useToast } from "@/components/toast";
import { Button, Card, Code, ErrorMessage, Field, Loading, NoAccess, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { checkAgainst, focusFirstError, formValues, hasErrors, type FieldErrors } from "@/lib/forms";
import { describe, matchesSearch } from "@/lib/format";
import { useQuery, useQueryField } from "@/lib/query";
import { useSession } from "@/lib/session";

import { ClientSummary, OutletEditing, OwnerSummary, Tag, useLinkedPhones } from "./client-editing";
import { OutletSubscription } from "./outlet-subscription";

type Outlet = OrganizationDto["outlets"][number];

/** What to write beside each field so it is typed correctly the first time. */
const HINT = {
  phone: "10 digits. Their one-time code is sent here.",
  gstin: "15 characters, for example 36ABCDE1234F1Z5.",
  pincode: "6 digits.",
};

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
      <NoAccess title="Clients">
        Client management is for Super Admins and Operations Managers. Supervisors work from the ECCS mobile app.
      </NoAccess>
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

  /** After any change to a client, the server sends the whole client back; it replaces the one in the list. */
  function changed(client: OrganizationDto) {
    setClients((current) => (current ?? []).map((c) => (c.id === client.id ? client : c)));
  }

  // Sorted here by name, whatever order the server sent.
  const sorted = [...(clients ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const matching = sorted.filter((client) =>
    matchesSearch(search, [client.name, ...client.outlets.flatMap((outlet) => [outlet.name, outlet.code])]),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Clients"
        description="Restaurants, their outlets and the codes their staff use to link a phone."
        action={!onboarding && <Button onClick={() => setOnboarding(true)}>Onboard a restaurant</Button>}
      />

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
                            {!client.isActive && (
                              <div className="pb-1.5 pl-7">
                                <Tag>Switched off</Tag>
                              </div>
                            )}
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
                              <ClientDetail client={client} onOutletAdded={(outlet) => outletAdded(client.id, outlet)} onChanged={changed} />
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

/**
 * What opens under a client's row: its details and everyone who owns it, its
 * outlets with their codes and plans, and adding an outlet. Each part has its
 * own Change link (see client-editing.tsx); nothing is ever deleted.
 */
function ClientDetail({
  client,
  onOutletAdded,
  onChanged,
}: {
  client: OrganizationDto;
  onOutletAdded: (outlet: Outlet) => void;
  onChanged: (client: OrganizationDto) => void;
}) {
  // Fetched once for the client and shared by its Owner and each outlet.
  const linked = useLinkedPhones(client.id);
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
      <ClientSummary client={client} onChanged={onChanged} />
      {client.owners.map((owner) => (
        <div key={owner.id} className="border-t border-border pt-3">
          <OwnerSummary client={client} owner={owner} linked={linked} onChanged={onChanged} />
        </div>
      ))}

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
                <td className="py-2.5 pr-4 font-medium">
                  {outlet.name}
                  {!outlet.isActive && (
                    <span className="ml-2">
                      <Tag>Switched off</Tag>
                    </span>
                  )}
                </td>
                <td className="py-2.5 pr-4 text-muted">
                  {[outlet.address, outlet.city, outlet.pincode].filter(Boolean).join(", ")}
                  {outlet.fssaiNumber && <div>FSSAI {outlet.fssaiNumber}</div>}
                </td>
                <td className="py-2.5">
                  <Code>{outlet.code}</Code>
                </td>
              </tr>
              {/* What can be changed about the outlet, then its plan, sit directly under it so they are read together. */}
              <tr className="border-b border-border last:border-0">
                <td colSpan={3} className="pb-3">
                  <div className="flex flex-col gap-2">
                    <OutletEditing client={client} outlet={outlet} linked={linked} onChanged={onChanged} />
                    {/* Shown for a switched-off outlet too: it gets no plan visits and is not renewed, but its plan can still be cancelled here. */}
                    <OutletSubscription outlet={outlet} />                  </div>
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
