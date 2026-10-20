"use client";

import { can, closeIncidentSchema, costWords, QUALITY_RULES, type IncidentDto } from "@eccs/shared";
import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { Button, Card, ErrorMessage, Field, LoadError, Loading, NoAccess, PageHeader, TextAreaField } from "@/components/ui";
import { api } from "@/lib/api";
import { checkAgainst, focusFirstError, hasErrors, type FieldErrors } from "@/lib/forms";
import { describe, english, longDay, shortDay, when } from "@/lib/format";
import { useNavCounts } from "@/lib/nav-counts";
import { useSession } from "@/lib/session";

import { paiseField, saveFile, Sheet, toPaise } from "../../../finance/finance-parts";
import { IncidentForm } from "../../incident-form";
import { IncidentStatusBadge } from "../../quality-parts";

// Pattern followed: SafetyCulture's investigation page (the status, the record and its evidence
// in one place, the actions beside it, and a PDF report to share) with the HSE accident book's
// fields in its order: the date, the place, what happened, what was done afterwards, who dealt
// with it. "One link has the whole story" (docs/CONSOLE_PLAN.md 4.5): there is no public link;
// the PDF is downloaded and sent by hand to an insurer or a lawyer.

export default function IncidentScreen({ incidentId }: { incidentId: string }) {
  const { user } = useSession();
  const allowed = user ? can(user.memberships, "quality", "read") : false;
  if (!allowed) return <NoAccess title="Incident">Incidents are for Super Admins and Operations Managers.</NoAccess>;
  return <Incident incidentId={incidentId} />;
}

type SheetName = "edit" | "close" | null;

function Incident({ incidentId }: { incidentId: string }) {
  const { user } = useSession();
  const notify = useToast();
  const confirm = useConfirm();
  const { refresh: refreshCounts } = useNavCounts();
  const mayChange = user ? can(user.memberships, "quality", "update") : false;
  const [loaded, setLoaded] = useState<IncidentDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [busy, setBusy] = useState<"pdf" | "reopen" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.quality
      .incident(incidentId)
      .then((next) => {
        if (cancelled) return;
        setLoaded(next);
        setError(null);
      })
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [incidentId, attempt]);

  const back = (
    <Link href="/quality?tab=incidents" className="w-fit rounded-md text-sm font-semibold text-primary hover:underline print:hidden">
      ← Quality: Incidents
    </Link>
  );
  const incident = loaded?.id === incidentId ? loaded : null;
  if (!incident) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        {error ? <LoadError message={error} onRetry={() => setAttempt((value) => value + 1)} /> : <Loading />}
      </div>
    );
  }

  /** A change saved: the page shows what the server sent back, and the menu's badge follows. */
  const saved = (next: IncidentDto, message: string) => {
    setLoaded(next);
    setSheet(null);
    refreshCounts();
    notify(message);
  };

  async function download() {
    setBusy("pdf");
    setActionError(null);
    try {
      const { blob, fileName } = await api.quality.incidentPdf(incidentId);
      saveFile(blob, fileName);
    } catch (e) {
      setActionError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  async function reopen(reference: string) {
    const sure = await confirm({
      title: `Reopen incident ${reference}?`,
      body: "It shows as open again in Quality and on Today until it is closed again.",
      confirmLabel: "Reopen it",
      cancelLabel: "Keep it closed",
      // Nothing is lost by reopening.
      tone: "primary",
    });
    if (!sure) return;
    setBusy("reopen");
    setActionError(null);
    try {
      saved(await api.quality.reopenIncident(incidentId), `Incident ${reference} reopened`);
    } catch (e) {
      setActionError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  const open = incident.status === "OPEN";
  const photos = incident.files.filter((file) => !file.isPdf);
  const pdfs = incident.files.filter((file) => file.isPdf);
  const visit = incident.visit;

  return (
    <div className="flex flex-col gap-6">
      {back}
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            Incident {incident.reference}
            <IncidentStatusBadge status={incident.status} />
          </span>
        }
        description={`${incident.outletName} · ${longDay(incident.happenedOn)}`}
        secondary={
          <>
            {mayChange && (
              <Button variant="secondary" onClick={() => setSheet("edit")}>
                Edit
              </Button>
            )}
            <Button variant="secondary" loading={busy === "pdf"} onClick={() => void download()}>
              Download the PDF
            </Button>
          </>
        }
        action={
          mayChange &&
          (open ? (
            <Button onClick={() => setSheet("close")}>Close with a note</Button>
          ) : (
            <Button variant="secondary" loading={busy === "reopen"} onClick={() => void reopen(incident.reference)}>
              Reopen
            </Button>
          ))
        }
      />
      <ErrorMessage message={actionError} />

      <Card className="flex max-w-4xl flex-col gap-6">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
          <Fact label="Status">
            {open ? "Open" : `Closed${incident.closedByName ? ` by ${incident.closedByName}` : ""}${incident.closedAt ? ` on ${when(incident.closedAt)}` : ""}`}
          </Fact>
          <Fact label="Where">
            {incident.organizationName} · {incident.outletName}
            {incident.outletAddress && <span className="block text-muted">{incident.outletAddress}</span>}
          </Fact>
          <Fact label="The visit">
            {visit ? (
              <>
                {shortDay(visit.date)} · {english(visit.serviceName)} · {visit.supervisorName ?? "No Supervisor"}
                {visit.reportNumber && ` · report ${visit.reportNumber}`}{" "}
                <Link href={`/visits?visit=${encodeURIComponent(visit.id)}`} className="font-semibold whitespace-nowrap text-primary hover:underline print:hidden">
                  Open the visit
                </Link>
              </>
            ) : (
              <span className="text-muted">Not during a visit</span>
            )}
          </Fact>
          <Fact label="The day it happened">{longDay(incident.happenedOn)}</Fact>
          <Fact label="What happened">
            <span className="whitespace-pre-wrap">{incident.whatHappened}</span>
          </Fact>
          <Fact label="What was done">
            {incident.whatWasDone ? <span className="whitespace-pre-wrap">{incident.whatWasDone}</span> : <span className="text-muted">Nothing recorded yet</span>}
          </Fact>
          <Fact label="Cost">{costWords(incident.costPaise)}</Fact>
        </dl>

        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <h2 className="font-bold">Photos and files</h2>
          {incident.files.length === 0 && <p className="text-sm text-muted">None yet. Edit adds them.</p>}
          {photos.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2" aria-label="Photos">
              {photos.map((photo, index) => (
                <li key={photo.id}>
                  <a href={api.fileUrl(photo.path)} target="_blank" rel="noreferrer" className="block">
                    {/* A signed link to private storage that expires within the hour: not for the image optimiser. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={api.fileUrl(photo.path)}
                      alt={`Photo ${index + 1} of incident ${incident.reference}. Opens full size.`}
                      className="max-h-96 w-full rounded-lg border border-border bg-background object-contain"
                    />
                  </a>
                </li>
              ))}
            </ul>
          )}
          {pdfs.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Files">
              {pdfs.map((file, index) => (
                <li key={file.id}>
                  <a
                    href={api.fileUrl(file.path)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-9 items-center rounded-lg border border-border-strong px-3 py-1.5 text-sm font-semibold hover:bg-background"
                  >
                    File {index + 1} (PDF)<span className="sr-only">, opens in a new tab</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        <dl className="grid gap-x-6 gap-y-3 border-t border-border pt-4 sm:grid-cols-[11rem_minmax(0,1fr)]">
          <Fact label="Added">
            By {incident.createdByName} on {when(incident.createdAt)}
          </Fact>
          {incident.closedAt && (
            <Fact label="Closed">
              By {incident.closedByName ?? "the office"} on {when(incident.closedAt)}
              {incident.closeNote && <span className="block whitespace-pre-wrap">{incident.closeNote}</span>}
            </Fact>
          )}
        </dl>
      </Card>

      <Sheet open={sheet === "edit"} title={`Edit incident ${incident.reference}`} onClose={() => setSheet(null)}>
        <IncidentForm incident={incident} onCancel={() => setSheet(null)} onSaved={(next) => saved(next, `Incident ${next.reference} saved`)} />
      </Sheet>
      <Sheet open={sheet === "close"} title={`Close incident ${incident.reference}`} onClose={() => setSheet(null)}>
        <CloseIncident incident={incident} onCancel={() => setSheet(null)} onClosed={(next) => saved(next, `Incident ${next.reference} closed`)} />
      </Sheet>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-sm font-semibold text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** How it ended, in a note, and the final cost: what was paid or done. */
function CloseIncident({ incident, onClosed, onCancel }: { incident: IncidentDto; onClosed: (next: IncidentDto) => void; onCancel: () => void }) {
  const [note, setNote] = useState("");
  const [cost, setCost] = useState(incident.costPaise != null ? paiseField(incident.costPaise) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const paise = cost.trim() ? toPaise(cost) : null;
    const input = { note, costRupees: paise === null ? null : paise / 100 };
    const found = checkAgainst(closeIncidentSchema, input);
    if (cost.trim() && paise === null) found.costRupees = "Enter the cost in rupees, figures only, for example 1200.";
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);

    setBusy(true);
    setError(null);
    try {
      onClosed(await api.quality.closeIncident(incident.id, input));
    } catch (e) {
      setError(describe(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <TextAreaField
        label="How it ended"
        name="note"
        required
        rows={4}
        autoFocus
        maxLength={QUALITY_RULES.textMax}
        hint="What was paid or done, and who agreed: for example, ₹1,200 replacement paid by ECCS; the owner accepted."
        value={note}
        error={errors.note}
        onChange={(e) => setNote(e.target.value)}
      />
      <Field
        label="Final cost, in rupees"
        name="costRupees"
        inputMode="decimal"
        hint="Leave empty if it cost nothing."
        value={cost}
        error={errors.costRupees}
        onChange={(e) => setCost(e.target.value)}
      />
      <ErrorMessage message={error} />
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button type="submit" loading={busy}>
          Close the incident
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
