"use client";

import {
  can,
  DOCUMENT_CATEGORIES,
  LICENCE_TYPES,
  type DocumentCategory,
  type DocumentDto,
  type LicenceDto,
  type LicenceReadingDto,
  type LicenceState,
  type LicenceType,
  type OutletSummaryDto,
} from "@eccs/shared";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { OutletScorePanel } from "@/components/outlet-score-panel";
import { useToast } from "@/components/toast";
import { Button, Card, ErrorMessage, Field, Loading, PageHeader, SelectField } from "@/components/ui";
import { api } from "@/lib/api";
import { focusFirstError, hasErrors, type FieldErrors } from "@/lib/forms";
import { describe, longDay as day, scrollBehavior } from "@/lib/format";
import { useNavCounts } from "@/lib/nav-counts";
import { useQueryField } from "@/lib/query";
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

const nameOf = (licence: LicenceDto) => licence.name ?? TYPE[licence.type];

const countdown = (licence: LicenceDto) =>
  licence.daysLeft < 0
    ? `${-licence.daysLeft} day${licence.daysLeft === -1 ? "" : "s"} overdue`
    : licence.daysLeft === 0
      ? "expires today"
      : `${licence.daysLeft} day${licence.daysLeft === 1 ? "" : "s"} left`;

function StateBadge({ state }: { state: LicenceState }) {
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${STATE[state].style}`}>
      {STATE[state].label}
    </span>
  );
}

/** The file chosen in a form's file input, if one was chosen. */
function chosenFile(form: HTMLFormElement): File | undefined {
  const file = new FormData(form).get("file");
  return file instanceof File && file.size > 0 ? file : undefined;
}

/** Uploads the file chosen in a form's file input, if any, and returns its id. */
async function uploadFrom(form: HTMLFormElement, outletId: string): Promise<string | undefined> {
  const file = chosenFile(form);
  if (!file) return undefined;
  const uploaded = await api.attachments.upload({ outletId, file, kind: "DOCUMENT", fileName: file.name });
  return uploaded.id;
}

/**
 * Uploads a licence document as soon as it is chosen and asks the server to
 * read the number and dates off it, so the form can be filled in for the
 * person to check. `onDetails` receives whatever could be read.
 */
function useLicenceFile(outletId: string, onDetails: (details: LicenceReadingDto) => void) {
  const [attachmentId, setAttachmentId] = useState<string>();
  const [reading, setReading] = useState<"working" | "filled" | "nothing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Counts the files chosen, so a slow answer about an earlier file is ignored.
  const latestChoice = useRef(0);

  async function choose(file: File | undefined) {
    const choice = ++latestChoice.current;
    setAttachmentId(undefined);
    setError(null);
    setReading(file ? "working" : null);
    if (!file) return;
    try {
      const uploaded = await api.attachments.upload({ outletId, file, kind: "DOCUMENT", fileName: file.name });
      if (choice !== latestChoice.current) return;
      setAttachmentId(uploaded.id);
      const details = await api.licences.read(uploaded.id);
      if (choice !== latestChoice.current) return;
      onDetails(details);
      setReading(details.expiresOn || details.number ? "filled" : "nothing");
    } catch (e) {
      if (choice !== latestChoice.current) return;
      setReading(null);
      setError(describe(e));
    }
  }

  // Announced to screen readers as it changes. While the document is being read, the Save button says "Please wait…", and this line says why.
  const note =
    reading === "working" ? (
      <p role="status" className="text-sm text-muted sm:col-span-full">
        Reading the document… Save is ready as soon as this finishes.
      </p>
    ) : reading === "filled" ? (
      <p role="status" className="text-sm font-medium text-primary sm:col-span-full">
        ✓ Filled in from the document. Please check the details before saving.
      </p>
    ) : reading === "nothing" ? (
      <p role="status" className="text-sm text-muted sm:col-span-full">
        Could not read the details from this file. Please type them in.
      </p>
    ) : error ? (
      <p role="alert" className="text-sm text-danger sm:col-span-full">
        {error}
      </p>
    ) : null;

  return { attachmentId, working: reading === "working", note, choose };
}

/**
 * Does something to a licence or document, then reloads the page's lists and
 * confirms it briefly. Returns `null` if it worked, or what went wrong, for
 * the row or form that asked to show beside itself.
 */
type Change = (action: () => Promise<unknown>, done: string) => Promise<string | null>;

interface OutletRecords {
  outletId: string;
  licences: LicenceDto[];
  documents: DocumentDto[];
}

/**
 * Licences across all clients that are expired or about to expire, and a
 * place to keep any outlet's licences and documents up to date on its behalf.
 *
 * The outlet being looked at is kept in the web address as `outlet=`.
 */
export default function LicencesScreen() {
  const { user } = useSession();
  const notify = useToast();
  const confirm = useConfirm();
  const { refresh: refreshCounts } = useNavCounts();
  const [outletId, setOutletId] = useQueryField("outlet", "push");

  const [attention, setAttention] = useState<LicenceDto[] | null>(null);
  const [outlets, setOutlets] = useState<OutletSummaryDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Kept with the outlet they belong to, so choosing another outlet never shows the last one's records.
  const [records, setRecords] = useState<OutletRecords | null>(null);
  const [recordsError, setRecordsError] = useState<{ outletId: string; message: string } | null>(null);
  /** The licence whose renew form is open, if any. */
  const [renewingId, setRenewingId] = useState<string | null>(null);
  // Counts the clicks on "Renew" under "Needs attention", so a second click on the same licence brings its form back into view.
  const [renewRequest, setRenewRequest] = useState(0);
  const [documentError, setDocumentError] = useState<{ id: string; message: string } | null>(null);
  const outletSection = useRef<HTMLElement>(null);

  // Supervisors can look; Super Admins and Operations Managers can also add and change.
  const mayEdit = user ? can(user.memberships, "licences", "create") : false;

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.licences.list({ attentionOnly: true }), api.outlets.list()])
      .then(([list, outletList]) => {
        if (cancelled) return;
        setAttention(list);
        setOutlets(outletList);
        setError(null);
      })
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    if (!outletId) return;
    let cancelled = false;
    Promise.all([api.licences.list({ outletId }), api.documents.list(outletId)])
      .then(([licences, documents]) => !cancelled && setRecords({ outletId, licences, documents }))
      .catch((e) => !cancelled && setRecordsError({ outletId, message: describe(e) }));
    return () => {
      cancelled = true;
    };
  }, [outletId, attempt]);

  /** Shows an outlet's licences and documents, and brings them into view: they are below the table the click came from. */
  function showOutlet(id: string, renewLicenceId: string | null = null) {
    setOutletId(id);
    setRenewingId(renewLicenceId);
    setRenewRequest((count) => count + 1);
    outletSection.current?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    // When renewing, the renew form takes the cursor itself once it is on the page.
    if (!renewLicenceId) outletSection.current?.querySelector("select")?.focus({ preventScroll: true });
  }

  const change: Change = async (action, done) => {
    try {
      await action();
      const [attentionList, licences, documents] = await Promise.all([
        api.licences.list({ attentionOnly: true }),
        api.licences.list({ outletId }),
        api.documents.list(outletId),
      ]);
      setAttention(attentionList);
      setRecords({ outletId, licences, documents });
      refreshCounts();
      notify(done);
      return null;
    } catch (e) {
      return describe(e);
    }
  };

  async function deleteDocument(document: DocumentDto) {
    const sure = await confirm({
      title: `Delete "${document.title}"?`,
      body: "It is deleted from this outlet's documents. This cannot be undone.",
      confirmLabel: "Delete the document",
      cancelLabel: "Keep the document",
    });
    if (!sure) return;
    setDocumentError(null);
    const failure = await change(() => api.documents.remove(document.id), "Document deleted");
    if (failure) setDocumentError({ id: document.id, message: failure });
  }

  const outlet = outlets.find((o) => o.id === outletId);
  const current = records && records.outletId === outletId ? records : null;
  const currentError = recordsError && recordsError.outletId === outletId && !current ? recordsError.message : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Licences" description="Which clients have licences expired or expiring within 60 days, and each outlet's documents." />

      <Card>
        <h2 className="text-lg font-bold">Needs attention</h2>
        {error && (
          <div className="mt-3 flex flex-col items-start gap-3">
            <ErrorMessage message={error} />
            <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </Button>
          </div>
        )}
        {attention === null && !error && <Loading className="mt-2" />}
        {attention?.length === 0 && <p className="mt-2 text-muted">No licences are expired or expiring soon.</p>}
        {attention && attention.length > 0 && (
          // The side padding keeps the focus ring of the first and last columns from being cut off by the scrolling box.
          <div className="-mx-4 mt-3 overflow-x-auto px-4">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr className="border-b border-border">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Client and outlet
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Licence
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Expires
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Status
                  </th>
                  {mayEdit && (
                    <th scope="col" className="py-2 font-medium">
                      <span className="sr-only">Action</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {attention.map((licence) => (
                  <tr key={licence.id} className="border-b border-border last:border-0">
                    <td className="py-2.5 pr-4">
                      <Button variant="link" className="-ml-2 text-left" onClick={() => showOutlet(licence.outletId)}>
                        {licence.outletName}
                        <span className="sr-only">: show its licences and documents</span>
                      </Button>
                      <div className="text-muted">{licence.organizationName}</div>
                    </td>
                    <td className="py-2.5 pr-4">{nameOf(licence)}</td>
                    <td className="py-2.5 pr-4">
                      {day(licence.expiresOn)}
                      <div className="text-muted">{countdown(licence)}</div>
                    </td>
                    <td className="py-2.5 pr-4">
                      <StateBadge state={licence.state} />
                    </td>
                    {mayEdit && (
                      <td className="py-2.5 text-right">
                        <Button variant="secondary" className="py-1.5" onClick={() => showOutlet(licence.outletId, licence.id)}>
                          Renew
                          <span className="sr-only">
                            {" "}
                            {nameOf(licence)} at {licence.outletName}
                          </span>
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <section ref={outletSection} className="flex scroll-mt-4 flex-col gap-5 rounded-xl border border-border bg-surface p-5">
        <SelectField
          label="Outlet"
          value={outletId}
          onChange={(e) => {
            setRenewingId(null);
            setOutletId(e.target.value);
          }}
          wrapperClassName="sm:max-w-md"
        >
          <option value="">Choose an outlet to see its licences and documents</option>
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>
              {o.organization.name} · {o.name}
            </option>
          ))}
        </SelectField>

        {outletId && !current && !currentError && <Loading />}
        {currentError && (
          <div className="flex flex-col items-start gap-3">
            <ErrorMessage message={currentError} />
            <Button
              variant="secondary"
              onClick={() => {
                setRecordsError(null);
                setAttempt((value) => value + 1);
              }}
            >
              Try again
            </Button>
          </div>
        )}

        {/* Read only: the outlet's hygiene score, which its licences below count towards. */}
        {outlet && <OutletScorePanel outletId={outletId} outletName={outlet.name} />}

        {outlet && current && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-bold">Licences at {outlet.name}</h2>
            {current.licences.length === 0 && <p className="text-muted">No licences recorded.</p>}
            {current.licences.map((licence) => (
              <LicenceRow
                key={licence.id}
                licence={licence}
                mayEdit={mayEdit}
                outletId={outletId}
                renewing={renewingId === licence.id}
                renewRequest={renewRequest}
                onRenewing={(open) => setRenewingId(open ? licence.id : null)}
                onChange={change}
              />
            ))}
            {mayEdit && <AddLicenceForm key={outletId} outletId={outletId} existing={current.licences} onChange={change} />}
          </section>
        )}

        {outlet && current && (
          <section className="flex flex-col gap-3 border-t border-border pt-5">
            <h2 className="text-lg font-bold">Documents at {outlet.name}</h2>
            {current.documents.length === 0 && <p className="text-muted">No documents stored.</p>}
            {current.documents.length > 0 && (
              <ul className="flex flex-col divide-y divide-border text-sm">
                {current.documents.map((document) => (
                  <li key={document.id} className="flex flex-col gap-2 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <a href={api.fileUrl(document.file.path)} target="_blank" rel="noreferrer" className="inline-block py-0.5 font-medium text-primary hover:underline">
                          {document.title}
                        </a>
                        <div className="text-muted">
                          {CATEGORY[document.category]} · {document.file.mimeType === "application/pdf" ? "PDF" : "Image"} · added{" "}
                          {day(document.createdAt)} by {document.uploadedByEccs ? "ECCS" : "the restaurant"}
                          {document.uploadedByName ? ` (${document.uploadedByName})` : ""}
                        </div>
                      </div>
                      {mayEdit && (
                        <Button variant="link" className="text-danger" onClick={() => void deleteDocument(document)}>
                          Delete
                          <span className="sr-only"> {document.title}</span>
                        </Button>
                      )}
                    </div>
                    {documentError?.id === document.id && <ErrorMessage message={documentError.message} />}
                  </li>
                ))}
              </ul>
            )}
            {mayEdit && <AddDocumentForm key={outletId} outletId={outletId} onChange={change} />}
          </section>
        )}
      </section>
    </div>
  );
}

function LicenceRow({
  licence,
  mayEdit,
  outletId,
  renewing,
  renewRequest,
  onRenewing,
  onChange,
}: {
  licence: LicenceDto;
  mayEdit: boolean;
  outletId: string;
  renewing: boolean;
  renewRequest: number;
  onRenewing: (open: boolean) => void;
  onChange: Change;
}) {
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    const sure = await confirm({
      title: `Remove "${nameOf(licence)}"?`,
      body: "The licence is taken off this outlet's list. Its document stays in Documents.",
      confirmLabel: "Remove the licence",
      cancelLabel: "Keep the licence",
    });
    if (!sure) return;
    setError(null);
    setError(await onChange(() => api.licences.remove(licence.id), "Licence removed"));
  }

  return (
    <div className="rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{nameOf(licence)}</p>
          <p className="text-muted">
            {licence.number ? `${licence.number} · ` : ""}
            {licence.state === "EXPIRED" ? "expired" : "expires"} {day(licence.expiresOn)} · {countdown(licence)}
          </p>
          {licence.file ? (
            <a href={api.fileUrl(licence.file.path)} target="_blank" rel="noreferrer" className="inline-block py-0.5 font-medium text-primary hover:underline">
              View document
            </a>
          ) : (
            <span className="text-muted">No document attached</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <StateBadge state={licence.state} />
          {mayEdit && !renewing && (
            <>
              <Button variant="link" className="ml-2" onClick={() => onRenewing(true)}>
                Renew
              </Button>
              <Button variant="link" className="text-danger" onClick={() => void remove()}>
                Remove
              </Button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-2">
          <ErrorMessage message={error} />
        </div>
      )}

      {renewing && <RenewForm licence={licence} outletId={outletId} request={renewRequest} onChange={onChange} onClose={() => onRenewing(false)} />}
    </div>
  );
}

function RenewForm({
  licence,
  outletId,
  request,
  onChange,
  onClose,
}: {
  licence: LicenceDto;
  outletId: string;
  /** Changes each time "Renew" is clicked under "Needs attention". */
  request: number;
  onChange: Change;
  onClose: () => void;
}) {
  const [number, setNumber] = useState(licence.number ?? "");
  const [expiresOn, setExpiresOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const formRef = useRef<HTMLFormElement>(null);
  // A date already typed is left alone; the number starts as the old licence's, so the one on the new document wins.
  const file = useLicenceFile(outletId, (details) => {
    if (details.number) setNumber(details.number);
    if (details.expiresOn) setExpiresOn((current) => current || details.expiresOn!);
  });

  // The form may open far down the page from the "Renew" that was clicked (the one under "Needs attention"), so it is brought into view and takes the cursor.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    form.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
    form.querySelector("input")?.focus({ preventScroll: true });
  }, [request]);

  async function renew(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const found: FieldErrors = expiresOn ? {} : { expiresOn: "Enter the new expiry date." };
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);

    setBusy(true);
    setError(null);
    const failure = await onChange(
      async () =>
        api.licences.update(licence.id, {
          expiresOn,
          number: number.trim() || undefined,
          attachmentId: file.attachmentId ?? (await uploadFrom(form, outletId)),
        }),
      "Licence renewed",
    );
    setBusy(false);
    if (failure) setError(failure);
    else onClose();
  }

  return (
    <form ref={formRef} onSubmit={renew} noValidate aria-label={`Renew ${nameOf(licence)}`} className="mt-3 grid items-start gap-3 border-t border-border pt-3 sm:grid-cols-3">
      <Field
        label="New copy (PDF or image)"
        name="file"
        type="file"
        accept="application/pdf,image/*"
        hint="Choose it first and the details are filled in for you."
        onChange={(e) => void file.choose(e.target.files?.[0])}
        wrapperClassName="sm:col-span-3"
      />
      {file.note}
      <Field label="Licence number" name="number" maxLength={60} value={number} onChange={(e) => setNumber(e.target.value)} />
      <Field
        label="New expiry date"
        name="expiresOn"
        type="date"
        required
        value={expiresOn}
        error={errors.expiresOn}
        onChange={(e) => setExpiresOn(e.target.value)}
      />
      <div className="flex flex-col gap-3 sm:col-span-3">
        <ErrorMessage message={error} />
        <div className="flex gap-3">
          <Button type="submit" loading={busy || file.working}>
            Save
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}

function AddLicenceForm(props: { outletId: string; existing: LicenceDto[]; onChange: Change }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div>
        <Button variant="link" className="-ml-2" onClick={() => setOpen(true)}>
          + Add a licence
        </Button>
      </div>
    );
  }
  return <AddLicenceFields {...props} onClose={() => setOpen(false)} />;
}

function AddLicenceFields({
  outletId,
  existing,
  onChange,
  onClose,
}: {
  outletId: string;
  existing: LicenceDto[];
  onChange: Change;
  onClose: () => void;
}) {
  const [type, setType] = useState<LicenceType>("FSSAI");
  const [number, setNumber] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  // Anything already typed is left alone.
  const file = useLicenceFile(outletId, (details) => {
    if (details.type && details.type !== "OTHER") setType(details.type);
    if (details.number) setNumber((current) => current.trim() || details.number!);
    if (details.expiresOn) setExpiresOn((current) => current || details.expiresOn!);
  });
  // An outlet holds one licence of each standard kind, so adding the same kind again replaces the current one.
  const replacing = type === "OTHER" ? undefined : existing.find((licence) => licence.type === type);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const text = (key: string) => String(values.get(key) ?? "").trim() || undefined;

    const found: FieldErrors = {};
    if (type === "OTHER" && !text("name")) found.name = "Give the licence a name.";
    if (!expiresOn) found.expiresOn = "Enter the expiry date.";
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);

    setBusy(true);
    setError(null);
    const failure = await onChange(
      async () =>
        api.licences.create({
          outletId,
          type,
          name: text("name"),
          number: number.trim() || undefined,
          expiresOn,
          attachmentId: file.attachmentId ?? (await uploadFrom(form, outletId)),
        }),
      replacing ? "Licence replaced" : "Licence added",
    );
    setBusy(false);
    if (failure) setError(failure);
    else onClose();
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Add a licence" className="grid items-start gap-3 rounded-lg border border-primary p-3 sm:grid-cols-2">
      <Field
        label="Document (PDF or image)"
        name="file"
        type="file"
        accept="application/pdf,image/*"
        hint="Choose it first and the details below are filled in for you."
        onChange={(e) => void file.choose(e.target.files?.[0])}
        wrapperClassName="sm:col-span-2"
      />
      {file.note}
      <SelectField label="Licence" name="type" value={type} onChange={(e) => setType(e.target.value as LicenceType)}>
        {LICENCE_TYPES.map((value) => (
          <option key={value} value={value}>
            {TYPE[value]}
          </option>
        ))}
      </SelectField>
      <Field
        label="Name"
        name="name"
        maxLength={80}
        required={type === "OTHER"}
        hint={type === "OTHER" ? undefined : "Leave blank to use the standard name."}
        error={errors.name}
      />
      <Field label="Licence number" name="number" maxLength={60} value={number} onChange={(e) => setNumber(e.target.value)} />
      <Field
        label="Expiry date"
        name="expiresOn"
        type="date"
        required
        value={expiresOn}
        error={errors.expiresOn}
        onChange={(e) => setExpiresOn(e.target.value)}
      />
      {replacing && (
        <p className="text-sm text-amber-700 sm:col-span-2">
          This outlet already has a {nameOf(replacing)}. Saving will replace it, and its old document will be deleted.
        </p>
      )}
      <div className="flex flex-col gap-3 sm:col-span-2">
        <ErrorMessage message={error} />
        <div className="flex gap-3">
          <Button type="submit" loading={busy || file.working}>
            {replacing ? "Replace licence" : "Add licence"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}

function AddDocumentForm({ outletId, onChange }: { outletId: string; onChange: Change }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  function close() {
    setOpen(false);
    setError(null);
    setErrors({});
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const title = String(values.get("title") ?? "").trim();

    const found: FieldErrors = {};
    if (title.length < 2) found.title = "Give the document a name.";
    if (!chosenFile(form)) found.file = "Choose a file to upload.";
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);

    setBusy(true);
    setError(null);
    const failure = await onChange(async () => {
      const attachmentId = await uploadFrom(form, outletId);
      if (!attachmentId) throw new Error("No file was chosen");
      await api.documents.create({
        outletId,
        category: String(values.get("category")) as Exclude<DocumentCategory, "licence">,
        title,
        attachmentId,
      });
    }, "Document uploaded");
    setBusy(false);
    if (failure) setError(failure);
    else close();
  }

  if (!open) {
    return (
      <div>
        <Button variant="link" className="-ml-2" onClick={() => setOpen(true)}>
          + Upload a document
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Upload a document" className="grid items-start gap-3 rounded-lg border border-primary p-3 sm:grid-cols-2">
      <Field label="Name of the document" name="title" required maxLength={100} error={errors.title} />
      <SelectField label="Kind" name="category" defaultValue="certificate">
        {DOCUMENT_CATEGORIES.filter((value) => value !== "licence").map((value) => (
          <option key={value} value={value}>
            {CATEGORY[value]}
          </option>
        ))}
      </SelectField>
      <Field label="File (PDF or image)" name="file" type="file" accept="application/pdf,image/*" required error={errors.file} wrapperClassName="sm:col-span-2" />
      <div className="flex flex-col gap-3 sm:col-span-2">
        <ErrorMessage message={error} />
        <div className="flex gap-3">
          <Button type="submit" loading={busy}>
            Upload
          </Button>
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}
