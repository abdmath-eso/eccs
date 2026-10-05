"use client";

import { ApiError } from "@eccs/api-client";
import { can, type OrganizationDto } from "@eccs/shared";
import { useEffect, useState, type FormEvent } from "react";

import { Button, Card, Code, ErrorMessage, Field } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

const describe = (error: unknown) =>
  error instanceof ApiError
    ? error.isNetworkError
      ? "Could not reach the server. Is the API running?"
      : error.message
    : "Something went wrong. Try again.";

/** Reads a form into a plain object of its text fields. */
const formValues = (form: HTMLFormElement) =>
  Object.fromEntries([...new FormData(form).entries()].map(([key, value]) => [key, String(value)]));

/** Clients: every restaurant ECCS serves, its outlets and restaurant codes, and onboarding. */
export default function ClientsPage() {
  const { user } = useSession();
  const [clients, setClients] = useState<OrganizationDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [justCreated, setJustCreated] = useState<OrganizationDto | null>(null);

  const mayManage = user ? can(user.memberships, "clients", "create") : false;

  useEffect(() => {
    if (!mayManage) return;
    let cancelled = false;
    api.organizations
      .list()
      .then((list) => !cancelled && setClients(list))
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [mayManage]);

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
    setClients((current) => [...(current ?? []), client].sort((a, b) => a.name.localeCompare(b.name)));
    setJustCreated(client);
    setOnboarding(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Clients</h1>
          <p className="text-muted">Restaurants, their outlets and the codes their staff use to link a phone.</p>
        </div>
        {!onboarding && <Button onClick={() => setOnboarding(true)}>Onboard a restaurant</Button>}
      </div>

      <ErrorMessage message={error} />

      {justCreated && <HandoverCard client={justCreated} onDismiss={() => setJustCreated(null)} />}
      {onboarding && <OnboardForm onCreated={added} onCancel={() => setOnboarding(false)} />}

      {clients === null && !error && <p className="text-muted">Loading…</p>}
      {clients?.length === 0 && <p className="text-muted">No clients yet. Onboard the first restaurant.</p>}
      {clients?.map((client) => (
        <ClientCard
          key={client.id}
          client={client}
          onOutletAdded={(outlet) =>
            setClients((current) =>
              (current ?? []).map((c) => (c.id === client.id ? { ...c, outlets: [...c.outlets, outlet] } : c)),
            )
          }
        />
      ))}
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = formValues(event.currentTarget);
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
      <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Restaurant (brand) name" name="name" required maxLength={120} />
        <Field label="GSTIN" name="gstin" maxLength={15} />
        <Field label="Owner's name" name="ownerName" required maxLength={100} />
        <Field
          label="Owner's mobile number"
          name="ownerPhone"
          type="tel"
          required
          hint="Their one-time code is sent here."
        />
        <Field label="Owner's email" name="ownerEmail" type="email" />
        <span className="hidden sm:block" />
        <Field
          label="First outlet name"
          name="outletName"
          required
          maxLength={120}
          hint="For example: Spice Route, Jubilee Hills"
        />
        <Field label="Outlet address" name="outletAddress" required maxLength={300} />
        <Field label="PIN code" name="pincode" inputMode="numeric" maxLength={6} />
        <Field label="FSSAI licence number" name="fssaiNumber" maxLength={20} />
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

function ClientCard({
  client,
  onOutletAdded,
}: {
  client: OrganizationDto;
  onOutletAdded: (outlet: OrganizationDto["outlets"][number]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addOutlet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = formValues(event.currentTarget);
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
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">{client.name}</h2>
          {client.owners.map((owner) => (
            <p key={owner.id} className="text-sm text-muted">
              Owner: {owner.name} · {owner.phone ?? "no number"}
              {owner.email ? ` · ${owner.email}` : ""} ·{" "}
              {owner.hasPin ? "set up" : <span className="font-semibold text-danger">has not set up yet</span>}
            </p>
          ))}
        </div>
        {client.gstin && <span className="text-sm text-muted">GSTIN {client.gstin}</span>}
      </div>

      <table className="mt-4 w-full text-left text-sm">
        <thead className="text-muted">
          <tr className="border-b border-border">
            <th className="py-2 pr-4 font-medium">Outlet</th>
            <th className="py-2 pr-4 font-medium">Address</th>
            <th className="py-2 font-medium">Restaurant code</th>
          </tr>
        </thead>
        <tbody>
          {client.outlets.map((outlet) => (
            <tr key={outlet.id} className="border-b border-border last:border-0">
              <td className="py-2.5 pr-4 font-medium">{outlet.name}</td>
              <td className="py-2.5 pr-4 text-muted">
                {outlet.address}, {outlet.city}
              </td>
              <td className="py-2.5">
                <Code>{outlet.code}</Code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {adding ? (
        <form onSubmit={addOutlet} className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Outlet name" name="outletName" required maxLength={120} autoFocus />
          <Field label="Address" name="outletAddress" required maxLength={300} />
          <Field label="PIN code" name="pincode" inputMode="numeric" maxLength={6} />
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
        <Button variant="link" className="mt-3 text-sm" onClick={() => setAdding(true)}>
          + Add an outlet
        </Button>
      )}
    </Card>
  );
}
