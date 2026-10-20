"use client";

import {
  createIncidentSchema,
  QUALITY_RULES,
  updateIncidentSchema,
  type CreateIncidentInput,
  type IncidentDto,
  type OutletSummaryDto,
  type UpdateIncidentInput,
  type VisitSummaryDto,
} from "@eccs/shared";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

import { Button, ErrorMessage, Field, SelectField, TextAreaField } from "@/components/ui";
import { api } from "@/lib/api";
import { checkAgainst, focusFirstError, hasErrors, type FieldErrors } from "@/lib/forms";
import { describe, english, shortDay, today } from "@/lib/format";

import { paiseField, toPaise } from "../finance/finance-parts";

// The fields of an incident follow the HSE accident book (the date, the place, what happened,
// what was done afterwards) and SafetyCulture's investigations (the evidence, photos and files,
// kept with the record). The form sits in a panel from the right edge, as Finance's forms do.

/** A photo or file on the incident: already on it (`kept`), or uploaded in this form. */
interface FileRow {
  id: string;
  path: string;
  isPdf: boolean;
  name: string | null;
  kept: boolean;
}

/** "Fri 9 Oct · Chimney and hood cleaning · Naveen · SR-0012". */
const visitWords = (visit: VisitSummaryDto) =>
  [shortDay(visit.date), english(visit.serviceName), visit.supervisorName, visit.reportNumber].filter(Boolean).join(" · ");

/**
 * Adds an incident (with no `incident`), or changes one. The outlet is chosen once: its photos and
 * files are filed under it, and an incident cannot move to another outlet afterwards. The visit is
 * chosen from that outlet's visits, the most recent first.
 */
export function IncidentForm({ incident, onSaved, onCancel }: { incident?: IncidentDto; onSaved: (saved: IncidentDto) => void; onCancel: () => void }) {
  const [outlets, setOutlets] = useState<OutletSummaryDto[] | null>(null);
  const [outletId, setOutletId] = useState(incident?.outletId ?? "");
  const [visits, setVisits] = useState<{ outletId: string; list: VisitSummaryDto[] } | null>(null);
  const [visitId, setVisitId] = useState(incident?.visit?.id ?? "");
  const [happenedOn, setHappenedOn] = useState(incident?.happenedOn ?? today());
  const [whatHappened, setWhatHappened] = useState(incident?.whatHappened ?? "");
  const [whatWasDone, setWhatWasDone] = useState(incident?.whatWasDone ?? "");
  const [cost, setCost] = useState(incident?.costPaise != null ? paiseField(incident.costPaise) : "");
  const [files, setFiles] = useState<FileRow[]>(() => (incident?.files ?? []).map((file) => ({ ...file, name: null, kept: true })));
  const [removed, setRemoved] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (incident) return;
    api.outlets
      .list()
      .then(setOutlets)
      .catch((e) => setError(describe(e)));
  }, [incident]);

  useEffect(() => {
    if (!outletId) return;
    let cancelled = false;
    Promise.all([api.visits.list({ outletId, state: "closed" }), api.visits.list({ outletId, state: "open" })])
      .then(([closed, open]) => {
        if (cancelled) return;
        // Visits that happened (or are under way), the most recent first; a cancelled one never took place.
        const list = [...closed, ...open].filter((visit) => visit.status !== "CANCELLED").sort((a, b) => b.date.localeCompare(a.date));
        setVisits({ outletId, list });
      })
      .catch(() => !cancelled && setVisits({ outletId, list: [] }));
    return () => {
      cancelled = true;
    };
  }, [outletId]);

  const visitChoices = visits?.outletId === outletId ? visits.list : null;
  const organizations = new Map<string, { name: string; outlets: OutletSummaryDto[] }>();
  for (const outlet of outlets ?? []) {
    const group = organizations.get(outlet.organization.id) ?? { name: outlet.organization.name, outlets: [] };
    group.outlets.push(outlet);
    organizations.set(outlet.organization.id, group);
  }

  async function attach(event: ChangeEvent<HTMLInputElement>) {
    const chosen = [...(event.target.files ?? [])];
    event.target.value = "";
    if (chosen.length === 0 || !outletId) return;
    const room = QUALITY_RULES.maxIncidentFiles - files.length;
    setError(chosen.length > room ? `At most ${QUALITY_RULES.maxIncidentFiles} photos and files on one incident.` : null);
    setUploading(true);
    try {
      for (const file of chosen.slice(0, Math.max(0, room))) {
        const isPdf = file.type === "application/pdf";
        // A photo is filed as a proof photo and a PDF as a document, as the console's other uploads do.
        const filed = await api.attachments.upload({ outletId, file, kind: isPdf ? "DOCUMENT" : "PROOF", fileName: file.name });
        setFiles((current) => [...current, { id: filed.id, path: filed.path, isPdf, name: file.name, kept: false }]);
      }
    } catch (e) {
      setError(describe(e));
    } finally {
      setUploading(false);
    }
  }

  function remove(file: FileRow) {
    setFiles((current) => current.filter((entry) => entry.id !== file.id));
    if (file.kept) setRemoved((current) => [...current, file.id]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const paise = cost.trim() ? toPaise(cost) : null;
    const costRupees = paise === null ? null : paise / 100;
    const found = incident
      ? checkAgainst(updateIncidentSchema, { visitId: visitId || null, happenedOn, whatHappened, whatWasDone, costRupees })
      : checkAgainst(createIncidentSchema, { outletId, visitId: visitId || null, happenedOn, whatHappened, whatWasDone, costRupees });
    if (cost.trim() && paise === null) found.costRupees = "Enter the cost in rupees, figures only, for example 1200.";
    if (!happenedOn) found.happenedOn = "Choose the day it happened";
    else if (happenedOn > today()) found.happenedOn = "The day it happened cannot be after today.";
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);

    setBusy(true);
    setError(null);
    try {
      if (incident) {
        const input: UpdateIncidentInput = {
          visitId: visitId || null,
          happenedOn,
          whatHappened,
          // Emptied, it is cleared.
          whatWasDone: whatWasDone.trim(),
          costRupees,
          addAttachmentIds: files.filter((file) => !file.kept).map((file) => file.id),
          removeAttachmentIds: removed,
        };
        onSaved(await api.quality.updateIncident(incident.id, input));
      } else {
        const input: CreateIncidentInput = {
          outletId,
          visitId: visitId || null,
          happenedOn,
          whatHappened,
          whatWasDone: whatWasDone.trim() || undefined,
          costRupees,
          attachmentIds: files.map((file) => file.id),
        };
        onSaved(await api.quality.addIncident(input));
      }
    } catch (e) {
      setError(describe(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {incident ? (
        <p className="text-sm">
          <span className="font-semibold">Outlet:</span> {incident.organizationName} · {incident.outletName}
        </p>
      ) : (
        <SelectField
          label="Outlet"
          name="outletId"
          value={outletId}
          disabled={files.length > 0}
          hint={files.length > 0 ? "Remove the photos and files to change the outlet: they are filed under it." : undefined}
          error={errors.outletId}
          onChange={(e) => {
            setOutletId(e.target.value);
            setVisitId("");
          }}
        >
          <option value="">{outlets === null ? "Loading the outlets…" : "Choose the outlet"}</option>
          {[...organizations.entries()].map(([id, group]) => (
            <optgroup key={id} label={group.name}>
              {group.outlets.map((outlet) => (
                <option key={outlet.id} value={outlet.id}>
                  {outlet.name}
                </option>
              ))}
            </optgroup>
          ))}
        </SelectField>
      )}

      {outletId && (
        <SelectField label="The visit it happened on" name="visitId" value={visitId} hint="If it happened during an ECCS visit." error={errors.visitId} onChange={(e) => setVisitId(e.target.value)}>
          <option value="">{visitChoices === null ? "Loading the visits…" : "Not during a visit"}</option>
          {(visitChoices ?? []).map((visit) => (
            <option key={visit.id} value={visit.id}>
              {visitWords(visit)}
            </option>
          ))}
        </SelectField>
      )}

      <Field label="The day it happened" name="happenedOn" type="date" required max={today()} value={happenedOn} error={errors.happenedOn} onChange={(e) => setHappenedOn(e.target.value)} />
      <TextAreaField
        label="What happened"
        name="whatHappened"
        required
        rows={4}
        maxLength={QUALITY_RULES.textMax}
        hint="Who, what and where, as plainly as for an insurer: for example, degreaser splashed on a crew member's forearm during hood work."
        value={whatHappened}
        error={errors.whatHappened}
        onChange={(e) => setWhatHappened(e.target.value)}
      />
      <TextAreaField
        label="What was done"
        name="whatWasDone"
        rows={3}
        maxLength={QUALITY_RULES.textMax}
        hint="Straight after, and since: first aid, who was told, what was replaced."
        value={whatWasDone}
        error={errors.whatWasDone}
        onChange={(e) => setWhatWasDone(e.target.value)}
      />
      <Field
        label="Cost, in rupees"
        name="costRupees"
        inputMode="decimal"
        hint="What ECCS paid or will pay, if anything. Figures only."
        value={cost}
        error={errors.costRupees}
        onChange={(e) => setCost(e.target.value)}
      />

      <div className="flex flex-col gap-2 text-sm font-medium">
        <span>
          Photos and files <span className="font-normal text-muted">(optional)</span>
        </span>
        <span className="font-normal text-muted">
          Photos of what happened, a clinic note or a bill as a PDF; up to {QUALITY_RULES.maxIncidentFiles}. Photos are printed in the incident&apos;s PDF; PDFs stay here.
        </span>
        {files.length > 0 && (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Photos and files on this incident">
            {files.map((file, index) => (
              <li key={file.id} className="flex flex-col gap-1 font-normal">
                <a href={api.fileUrl(file.path)} target="_blank" rel="noreferrer" className="block">
                  {file.isPdf ? (
                    <span className="flex h-24 items-center justify-center rounded-lg border border-border bg-background px-2 text-center font-semibold">
                      PDF<span className="sr-only">: {file.name ?? `file ${index + 1}`}, opens in a new tab</span>
                    </span>
                  ) : (
                    // A signed link to private storage that expires within the hour: not for the image optimiser.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={api.fileUrl(file.path)} alt={`Photo ${index + 1}, opens full size`} className="h-24 w-full rounded-lg border border-border object-cover" />
                  )}
                </a>
                {file.name && <span className="truncate text-xs text-muted">{file.name}</span>}
                <Button type="button" variant="link" className="-mx-2 self-start text-sm" disabled={busy} onClick={() => remove(file)}>
                  Remove<span className="sr-only"> {file.isPdf ? "this file" : `photo ${index + 1}`}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
        <label
          aria-disabled={!outletId || uploading || undefined}
          className={`w-fit rounded-lg border border-border-strong px-3 py-2 font-semibold focus-within:ring-[3px] focus-within:ring-primary ${
            !outletId || uploading ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-background"
          }`}
        >
          {uploading ? "Uploading…" : "Add photos or PDFs"}
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="sr-only"
            disabled={!outletId || uploading || busy}
            onChange={(event) => void attach(event)}
          />
        </label>
        {!outletId && <span className="font-normal text-muted">Choose the outlet first: the photos and files are filed under it.</span>}
      </div>

      <ErrorMessage message={error} />
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button type="submit" loading={busy} disabled={uploading}>
          {incident ? "Save the changes" : "Add the incident"}
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
