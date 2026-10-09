"use client";

// The parts of a visit that came with the services of 9 Oct 2026: the meter
// reading a task may carry (the frying oil test) with its verdict, and, for
// work done with an outside partner, which partner it was and the result
// documents they sent (a lab report, a list of staff seen, an attendance
// sheet, an audit report). Used by the visit detail on the Visits page.

import {
  addVisitDocumentSchema,
  can,
  formatReading,
  READING_VERDICT_ENGLISH,
  readingVerdict,
  VISIT_MAX_DOCUMENTS,
  type VisitDto,
  type VisitTaskDto,
} from "@eccs/shared";
import { useState, type FormEvent } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { Button, ErrorMessage, Field } from "@/components/ui";
import { api } from "@/lib/api";
import { checkAgainst, focusFirstError, hasErrors, type FieldErrors } from "@/lib/forms";
import { describe, when } from "@/lib/format";
import { useSession } from "@/lib/session";

const VERDICT_STYLE = { WITHIN: "text-primary", CLOSE: "text-amber-700", OVER: "font-semibold text-danger" } as const;
// A symbol as well as a colour and the words, so the verdict never rests on colour alone.
const VERDICT_MARK = { WITHIN: "✓", CLOSE: "!", OVER: "✗" } as const;

/** The reading a task recorded, with how it stands against its limit: "24.9% · Close to the limit (limit 25%)". */
export function TaskReading({ task }: { task: VisitTaskDto }) {
  const reading = task.reading;
  if (!reading || reading.value === null) return null;
  const verdict = readingVerdict(reading.value, reading.limit);
  return (
    <span className={`block ${verdict ? VERDICT_STYLE[verdict] : ""}`}>
      {verdict && <span aria-hidden>{VERDICT_MARK[verdict]} </span>}
      <strong>{formatReading(reading.value)}%</strong>
      {verdict && ` · ${READING_VERDICT_ENGLISH[verdict]}`}
      {reading.limit !== null && <span className="text-muted"> (limit {formatReading(reading.limit)}%)</span>}
    </span>
  );
}

/**
 * Which partner did the work, and the result documents attached to the visit.
 * Shown for a kind of service a partner delivers, and for any visit that
 * already has a document. The office can attach a document from check-in
 * onwards, also long after the visit is finished: a lab's report comes days
 * later. Each one is filed in the outlet's documents, where the restaurant
 * reads it.
 */
export function VisitResults({ visit, onChanged }: { visit: VisitDto; onChanged: (visit: VisitDto, message: string) => void }) {
  const confirm = useConfirm();
  const { user } = useSession();
  // Taking a document away again is for the office (the same people who run the diary), not the Supervisor.
  const mayRemove = user ? can(user.memberships, "jobs", "create") : false;
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  const documents = visit.documents ?? [];
  if (!visit.partnerDelivered && documents.length === 0 && !visit.partnerName) return null;
  const mayAdd = visit.canAttachDocument && documents.length < VISIT_MAX_DOCUMENTS;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    const values = { title: String(data.get("title") ?? ""), partnerName: String(data.get("partnerName") ?? "") };
    const found = checkAgainst(addVisitDocumentSchema, values);
    if (!(file instanceof File) || file.size === 0) found.file = "Choose the file: a PDF or a picture.";
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);

    setBusy(true);
    setError(null);
    try {
      const saved = await api.visits.addDocument(visit.id, values, file as File, (file as File).name);
      setAdding(false);
      onChanged(saved, `Attached and filed in ${visit.outletName}'s documents: ${values.title.trim()}`);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(documentId: string, title: string) {
    const sure = await confirm({
      title: "Remove this document?",
      body: `"${title}" will be taken off the visit and out of ${visit.outletName}'s documents. The restaurant will no longer see it. This cannot be undone; you would attach the file again.`,
      confirmLabel: "Remove the document",
      cancelLabel: "Keep it",
    });
    if (!sure) return;
    setBusy(true);
    setError(null);
    try {
      onChanged(await api.visits.removeDocument(visit.id, documentId), `Removed: ${title}`);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <h3 className="text-sm font-semibold text-muted">Partner and result documents</h3>
      <p className="text-sm">
        <span className="text-muted">Done with: </span>
        {visit.partnerName ?? (visit.partnerDelivered ? "partner not recorded yet" : "ECCS's own team")}
      </p>

      {documents.length === 0 ? (
        <p className="text-sm text-muted">
          No result document yet. Attach the partner&apos;s report when it arrives; it is filed in the outlet&apos;s documents for
          the restaurant.
        </p>
      ) : (
        <ul className="flex flex-col text-sm">
          {documents.map((document) => (
            <li key={document.id} className="flex flex-wrap items-center justify-between gap-x-4 border-b border-border py-1.5 last:border-0">
              <span>
                <a className="font-semibold text-primary underline" href={api.fileUrl(document.file.path)} target="_blank" rel="noreferrer">
                  {document.title}
                </a>
                <span className="text-muted">
                  {" "}
                  · {document.file.mimeType === "application/pdf" ? "PDF" : "picture"} · added {when(document.createdAt)}
                </span>
              </span>
              {mayRemove && (
                <Button variant="link" disabled={busy} aria-label={`Remove ${document.title}`} onClick={() => void remove(document.id, document.title)}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!adding && <ErrorMessage message={error} />}
      {mayAdd && !adding && (
        <div>
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            Attach a result document
          </Button>
        </div>
      )}
      {!visit.canAttachDocument && visit.partnerDelivered && (visit.status === "SCHEDULED" || visit.status === "ASSIGNED") && (
        <p className="text-sm text-muted">A document can be attached once the Supervisor has checked in.</p>
      )}

      {adding && (
        <form onSubmit={submit} noValidate aria-label="Attach a result document" className="grid items-start gap-3 rounded-lg border border-primary p-3 sm:grid-cols-2">
          <Field
            label="What is it?"
            name="title"
            required
            maxLength={80}
            autoFocus
            hint="The restaurant sees this name in its documents. For example: Water test lab report, 9 Oct 2026."
            error={errors.title}
          />
          <Field
            label="Partner who did the work"
            name="partnerName"
            maxLength={80}
            defaultValue={visit.partnerName ?? ""}
            hint="The lab, clinic, training partner or audit agency. Printed on the service report."
            error={errors.partnerName}
          />
          <Field
            label="File (PDF or picture)"
            name="file"
            type="file"
            accept="application/pdf,image/*"
            required
            hint="Up to 10 MB."
            error={errors.file}
            wrapperClassName="sm:col-span-2"
          />
          <div className="flex flex-col gap-3 sm:col-span-2">
            <ErrorMessage message={error} />
            <div className="flex gap-3">
              <Button type="submit" loading={busy}>
                Attach and file it
              </Button>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
