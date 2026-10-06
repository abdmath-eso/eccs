"use client";

import { ApiError } from "@eccs/api-client";
import {
  can,
  DOCUMENT_CATEGORIES,
  LICENCE_TYPES,
  type DocumentCategory,
  type DocumentDto,
  type LicenceDto,
  type LicenceState,
  type LicenceType,
  type OutletSummaryDto,
} from "@eccs/shared";
import { useEffect, useState, type FormEvent } from "react";

import { Button, Card, ErrorMessage, Field } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

const TYPE: Record<LicenceType, string> = {
  FSSAI: "FSSAI licence",
  FIRE_NOC: "Fire NOC",
  TRADE_LICENCE: "Trade licence",
  PEST_CONTROL: "Pest control contract",
  OTHER: "Another licence",
};

const CATEGORY: Record<DocumentCategory, string> = {
  licence: "Licence",
  certificate: "Certificate",
  report: "Report",
  invoice: "Invoice or bill",
  other: "Other",
};

const STATE: Record<LicenceState, { label: string; style: string }> = {
  EXPIRED: { label: "Expired", style: "border-danger text-danger" },
  EXPIRING: { label: "Expiring soon", style: "border-amber-600 text-amber-700" },
  VALID: { label: "Valid", style: "border-primary text-primary" },
};

const describe = (error: unknown) =>
  error instanceof ApiError
    ? error.isNetworkError
      ? "Could not reach the server. Is the API running?"
      : error.message
    : "Something went wrong. Try again.";

const day = (isoDate: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(
    new Date(`${isoDate.slice(0, 10)}T00:00:00Z`),
  );

const countdown = (licence: LicenceDto) =>
  licence.daysLeft < 0
    ? `${-licence.daysLeft} day${licence.daysLeft === -1 ? "" : "s"} overdue`
    : licence.daysLeft === 0
      ? "expires today"
      : `${licence.daysLeft} day${licence.daysLeft === 1 ? "" : "s"} left`;

function StateBadge({ state }: { state: LicenceState }) {
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATE[state].style}`}>
      {STATE[state].label}
    </span>
  );
}

const selectStyle =
  "rounded-lg border border-border bg-surface px-3 py-2.5 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

/** Uploads the file chosen in a form's file input, if any, and returns its id. */
async function uploadFrom(form: HTMLFormElement, outletId: string): Promise<string | undefined> {
  const file = new FormData(form).get("file");
  if (!(file instanceof File) || file.size === 0) return undefined;
  const uploaded = await api.attachments.upload({ outletId, file, kind: "DOCUMENT", fileName: file.name });
  return uploaded.id;
}

/**
 * Licences across all clients that are expired or about to expire, and a
 * place to keep any outlet's licences and documents up to date on its behalf.
 */
export default function LicencesPage() {
  const { user } = useSession();
  const [attention, setAttention] = useState<LicenceDto[] | null>(null);
  const [outlets, setOutlets] = useState<OutletSummaryDto[]>([]);
  const [outletId, setOutletId] = useState("");
  const [licences, setLicences] = useState<LicenceDto[] | null>(null);
  const [documents, setDocuments] = useState<DocumentDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Supervisors can look; Super Admins and Operations Managers can also add and change.
  const mayEdit = user ? can(user.memberships, "licences", "create") : false;

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.licences.list({ attentionOnly: true }), api.outlets.list()])
      .then(([list, outletList]) => {
        if (cancelled) return;
        setAttention(list);
        setOutlets(outletList);
      })
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!outletId) return;
    let cancelled = false;
    Promise.all([api.licences.list({ outletId }), api.documents.list(outletId)])
      .then(([licenceList, documentList]) => {
        if (cancelled) return;
        setLicences(licenceList);
        setDocuments(documentList);
      })
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [outletId]);

  function selectOutlet(id: string) {
    setLicences(null);
    setDocuments(null);
    setError(null);
    setOutletId(id);
  }

  /** Reloads everything on the page after a change. */
  async function refresh() {
    const [attentionList, licenceList, documentList] = await Promise.all([
      api.licences.list({ attentionOnly: true }),
      api.licences.list({ outletId }),
      api.documents.list(outletId),
    ]);
    setAttention(attentionList);
    setLicences(licenceList);
    setDocuments(documentList);
  }

  async function change(action: () => Promise<unknown>): Promise<boolean> {
    setError(null);
    try {
      await action();
      await refresh();
      return true;
    } catch (e) {
      setError(describe(e));
      return false;
    }
  }

  const outlet = outlets.find((o) => o.id === outletId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Licences</h1>
        <p className="text-muted">Which clients have licences expired or expiring within 60 days, and each outlet&apos;s documents.</p>
      </div>

      <ErrorMessage message={error} />

      <Card>
        <h2 className="text-lg font-bold">Needs attention</h2>
        {attention === null && !error && <p className="mt-2 text-muted">Loading…</p>}
        {attention?.length === 0 && <p className="mt-2 text-muted">No licences are expired or expiring soon.</p>}
        {attention && attention.length > 0 && (
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-muted">
              <tr className="border-b border-border">
                <th className="py-2 pr-4 font-medium">Client and outlet</th>
                <th className="py-2 pr-4 font-medium">Licence</th>
                <th className="py-2 pr-4 font-medium">Expires</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {attention.map((licence) => (
                <tr key={licence.id} className="border-b border-border last:border-0">
                  <td className="py-2.5 pr-4">
                    <button className="cursor-pointer text-left font-medium text-primary hover:underline" onClick={() => selectOutlet(licence.outletId)}>
                      {licence.outletName}
                    </button>
                    <div className="text-muted">{licence.organizationName}</div>
                  </td>
                  <td className="py-2.5 pr-4">{licence.name ?? TYPE[licence.type]}</td>
                  <td className="py-2.5 pr-4">
                    {day(licence.expiresOn)}
                    <div className="text-muted">{countdown(licence)}</div>
                  </td>
                  <td className="py-2.5">
                    <StateBadge state={licence.state} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="flex flex-col gap-5">
        <label className="flex flex-col gap-1 text-sm font-medium sm:max-w-md">
          Outlet
          <select value={outletId} onChange={(e) => selectOutlet(e.target.value)} className={selectStyle}>
            <option value="">Choose an outlet to see its licences and documents</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.organization.name} · {o.name}
              </option>
            ))}
          </select>
        </label>

        {outlet && licences === null && !error && <p className="text-muted">Loading…</p>}

        {outlet && licences && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-bold">Licences at {outlet.name}</h2>
            {licences.length === 0 && <p className="text-muted">No licences recorded.</p>}
            {licences.map((licence) => (
              <LicenceRow key={licence.id} licence={licence} mayEdit={mayEdit} outletId={outletId} onChange={change} />
            ))}
            {mayEdit && <AddLicenceForm outletId={outletId} existing={licences} onChange={change} />}
          </section>
        )}

        {outlet && documents && (
          <section className="flex flex-col gap-3 border-t border-border pt-5">
            <h2 className="text-lg font-bold">Documents at {outlet.name}</h2>
            {documents.length === 0 && <p className="text-muted">No documents stored.</p>}
            {documents.length > 0 && (
              <ul className="flex flex-col divide-y divide-border text-sm">
                {documents.map((document) => (
                  <li key={document.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <div>
                      <a href={api.fileUrl(document.file.path)} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                        {document.title}
                      </a>
                      <div className="text-muted">
                        {CATEGORY[document.category]} · {document.file.mimeType === "application/pdf" ? "PDF" : "Image"} · added{" "}
                        {day(document.createdAt)} by {document.uploadedByEccs ? "ECCS" : "the restaurant"}
                        {document.uploadedByName ? ` (${document.uploadedByName})` : ""}
                      </div>
                    </div>
                    {mayEdit && (
                      <Button
                        variant="link"
                        className="text-danger"
                        onClick={() => {
                          if (window.confirm(`Delete "${document.title}"? This cannot be undone.`)) {
                            void change(() => api.documents.remove(document.id));
                          }
                        }}
                      >
                        Delete
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {mayEdit && <AddDocumentForm outletId={outletId} onChange={change} />}
          </section>
        )}
      </Card>
    </div>
  );
}

type Change = (action: () => Promise<unknown>) => Promise<boolean>;

function LicenceRow({ licence, mayEdit, outletId, onChange }: { licence: LicenceDto; mayEdit: boolean; outletId: string; onChange: Change }) {
  const [renewing, setRenewing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function renew(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const expiresOn = String(new FormData(form).get("expiresOn") ?? "");
    setBusy(true);
    const saved = await onChange(async () =>
      api.licences.update(licence.id, { expiresOn, attachmentId: await uploadFrom(form, outletId) }),
    );
    setBusy(false);
    if (saved) setRenewing(false);
  }

  return (
    <div className="rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{licence.name ?? TYPE[licence.type]}</p>
          <p className="text-muted">
            {licence.number ? `${licence.number} · ` : ""}
            {licence.state === "EXPIRED" ? "expired" : "expires"} {day(licence.expiresOn)} · {countdown(licence)}
          </p>
          {licence.file ? (
            <a href={api.fileUrl(licence.file.path)} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
              View document
            </a>
          ) : (
            <span className="text-muted">No document attached</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <StateBadge state={licence.state} />
          {mayEdit && !renewing && (
            <>
              <Button variant="link" onClick={() => setRenewing(true)}>
                Renew
              </Button>
              <Button
                variant="link"
                className="text-danger"
                onClick={() => {
                  if (window.confirm(`Remove "${licence.name ?? TYPE[licence.type]}"? Its document stays in Documents.`)) {
                    void onChange(() => api.licences.remove(licence.id));
                  }
                }}
              >
                Remove
              </Button>
            </>
          )}
        </div>
      </div>

      {renewing && (
        <form onSubmit={renew} className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="New expiry date" name="expiresOn" type="date" required />
          <Field label="New copy (PDF or image)" name="file" type="file" accept="application/pdf,image/*" />
          <div className="flex items-end gap-3">
            <Button type="submit" loading={busy}>
              Save
            </Button>
            <Button type="button" variant="secondary" onClick={() => setRenewing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function AddLicenceForm({ outletId, existing, onChange }: { outletId: string; existing: LicenceDto[]; onChange: Change }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<LicenceType>("FSSAI");
  const [busy, setBusy] = useState(false);
  // An outlet holds one licence of each standard kind, so adding the same kind again replaces the current one.
  const replacing = type === "OTHER" ? undefined : existing.find((licence) => licence.type === type);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const text = (key: string) => String(values.get(key) ?? "").trim() || undefined;
    setBusy(true);
    const saved = await onChange(async () =>
      api.licences.create({
        outletId,
        type,
        name: text("name"),
        number: text("number"),
        expiresOn: text("expiresOn") ?? "",
        attachmentId: await uploadFrom(form, outletId),
      }),
    );
    setBusy(false);
    if (saved) setOpen(false);
  }

  if (!open) {
    return (
      <div>
        <Button variant="link" onClick={() => setOpen(true)}>
          + Add a licence
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border border-primary p-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Licence
        <select value={type} onChange={(e) => setType(e.target.value as LicenceType)} className={selectStyle}>
          {LICENCE_TYPES.map((value) => (
            <option key={value} value={value}>
              {TYPE[value]}
            </option>
          ))}
        </select>
      </label>
      <Field label="Name" name="name" maxLength={80} required={type === "OTHER"} hint={type === "OTHER" ? undefined : "Leave blank to use the standard name."} />
      <Field label="Licence number" name="number" maxLength={60} />
      <Field label="Expiry date" name="expiresOn" type="date" required />
      <Field label="Document (PDF or image)" name="file" type="file" accept="application/pdf,image/*" />
      {replacing && (
        <p className="text-sm text-amber-700 sm:col-span-2">
          This outlet already has a {replacing.name ?? TYPE[replacing.type]}. Saving will replace it, and its old document will be deleted.
        </p>
      )}
      <div className="flex items-end gap-3">
        <Button type="submit" loading={busy}>
          {replacing ? "Replace licence" : "Add licence"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function AddDocumentForm({ outletId, onChange }: { outletId: string; onChange: Change }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    const saved = await onChange(async () => {
      const attachmentId = await uploadFrom(form, outletId);
      if (!attachmentId) throw new ApiError("Choose a file to upload.", 400);
      await api.documents.create({
        outletId,
        category: String(values.get("category")) as Exclude<DocumentCategory, "licence">,
        title: String(values.get("title") ?? ""),
        attachmentId,
      });
    });
    setBusy(false);
    if (saved) setOpen(false);
  }

  if (!open) {
    return (
      <div>
        <Button variant="link" onClick={() => setOpen(true)}>
          + Upload a document
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border border-primary p-3 sm:grid-cols-2">
      <Field label="Name of the document" name="title" required minLength={2} maxLength={100} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        Kind
        <select name="category" defaultValue="certificate" className={selectStyle}>
          {DOCUMENT_CATEGORIES.filter((value) => value !== "licence").map((value) => (
            <option key={value} value={value}>
              {CATEGORY[value]}
            </option>
          ))}
        </select>
      </label>
      <Field label="File (PDF or image)" name="file" type="file" accept="application/pdf,image/*" required />
      <div className="flex items-end gap-3">
        <Button type="submit" loading={busy}>
          Upload
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
