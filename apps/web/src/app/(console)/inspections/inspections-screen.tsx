"use client";

import {
  can,
  type InspectionCheckDto,
  type InspectionDto,
  type InspectionGrade,
  type InspectionOutletDto,
  type InspectionSeverity,
  type InspectionStatus,
  type InspectionSummaryDto,
  type SupervisorDto,
} from "@eccs/shared";
import { useEffect, useState, type FormEvent } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { MasterDetail } from "@/components/master-detail";
import { useToast } from "@/components/toast";
import { Button, Card, ErrorMessage, Field, Loading, SelectField, ToggleGroup } from "@/components/ui";
import { api } from "@/lib/api";
import { focusFirstError, hasErrors, type FieldErrors } from "@/lib/forms";
import { describe, english, shortDay, today, when } from "@/lib/format";
import { isPlainClick, useQuery } from "@/lib/query";
import { useSession } from "@/lib/session";

const STATUS: Record<InspectionStatus, { label: string; style: string }> = {
  PLANNED: { label: "To do", style: "border-foreground text-foreground" },
  IN_PROGRESS: { label: "Under way", style: "border-primary text-primary" },
  SUBMITTED: { label: "Report to approve", style: "border-danger text-danger" },
  APPROVED: { label: "Approved", style: "border-primary text-primary" },
};

const GRADE: Record<InspectionGrade, { label: string; style: string }> = {
  A_PLUS: { label: "A+ · Exemplary", style: "text-primary" },
  A: { label: "A · Satisfactory", style: "text-primary" },
  B: { label: "B · Needs improvement", style: "text-foreground" },
  NON_COMPLIANT: { label: "No grade · Not compliant", style: "text-danger" },
};

const SEVERITY: Record<InspectionSeverity, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", CRITICAL: "Critical" };

/** The quick filters over the list. They are kept in the web address as `show=`. */
const SHOW = ["all", "todo", "review", "approved"] as const;
type Show = (typeof SHOW)[number];

function StatusBadge({ status }: { status: InspectionStatus }) {
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS[status].style}`}>
      {STATUS[status].label}
    </span>
  );
}

/** The score and the grade in words, e.g. "97 out of 100 · A+ · Exemplary". */
function scoreLine(inspection: InspectionSummaryDto) {
  if (inspection.overallScore === null) return null;
  return `${inspection.overallScore} out of 100${inspection.grade ? ` · ${GRADE[inspection.grade].label}` : ""}`;
}

function checkDate(date: string): string | undefined {
  if (!date) return "Choose a date.";
  if (date < today()) return "Choose today or a later date.";
  return undefined;
}

/**
 * Scored inspections. ECCS plans an inspection of an outlet and gives it to a
 * Supervisor, who answers the 92 checks in the mobile app. The finished report
 * waits here to be approved (or sent back with a note); only an approved
 * report is final and visible to the restaurant.
 *
 * What is being looked at lives in the web address: `show=` for the filter,
 * `inspection=` for the one that is open and `new=1` while one is being planned.
 */
export default function InspectionsScreen() {
  const query = useQuery();
  const notify = useToast();
  const { user } = useSession();
  // Super Admins and Operations Managers plan and approve; a Supervisor only reads their own here.
  const admin = user ? can(user.memberships, "inspections", "approve") : false;

  const asked = query.get("show") as Show;
  const show: Show = SHOW.includes(asked) ? asked : "all";
  const inspectionId = query.get("inspection");
  const adding = query.get("new") === "1";

  const [list, setList] = useState<InspectionSummaryDto[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [supervisors, setSupervisors] = useState<SupervisorDto[]>([]);
  const [detail, setDetail] = useState<InspectionDto | null>(null);
  const [detailError, setDetailError] = useState<{ id: string; message: string } | null>(null);

  /** Raised after anything changes, or to try again, to fetch the list again. */
  const [version, setVersion] = useState(0);
  const [detailAttempt, setDetailAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.inspections
      .list()
      .then((inspections) => {
        if (cancelled) return;
        setList(inspections);
        setListError(null);
      })
      .catch((e) => !cancelled && setListError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [version]);

  useEffect(() => {
    // The Supervisor list is only sent to admins, so it stays empty for anyone else.
    api.services
      .supervisors()
      .then(setSupervisors)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!inspectionId) return;
    let cancelled = false;
    api.inspections
      .get(inspectionId)
      .then((inspection) => !cancelled && setDetail(inspection))
      .catch((e) => !cancelled && setDetailError({ id: inspectionId, message: describe(e) }));
    return () => {
      cancelled = true;
    };
  }, [inspectionId, detailAttempt]);

  /** After anything changes: say so briefly and bring the list up to date. */
  function changed(message: string, inspection?: InspectionDto) {
    if (inspection) setDetail(inspection);
    setVersion((current) => current + 1);
    notify(message);
  }

  const all = list ?? [];
  const matching: Record<Show, InspectionSummaryDto[]> = {
    all,
    todo: all.filter((inspection) => inspection.status === "PLANNED" || inspection.status === "IN_PROGRESS"),
    review: all.filter((inspection) => inspection.status === "SUBMITTED"),
    approved: all.filter((inspection) => inspection.status === "APPROVED"),
  };
  // Reports waiting to be approved come first; they are what ECCS has to act on.
  const shown = [...matching[show]].sort((a, b) => Number(b.status === "SUBMITTED") - Number(a.status === "SUBMITTED"));

  const open = detail && detail.id === inspectionId ? detail : null;
  const openError = detailError && detailError.id === inspectionId ? detailError.message : null;

  const detailPanel = adding ? (
    <PlanInspection
      supervisors={supervisors}
      onDone={(inspection) => {
        query.set({ new: null, inspection: inspection.id }, "replace");
        changed(`Inspection planned for ${shortDay(inspection.date)}`, inspection);
      }}
      onCancel={() => query.set({ new: null }, "replace")}
    />
  ) : open ? (
    <InspectionDetail
      key={`${open.id}-${open.status}`}
      inspection={open}
      supervisors={supervisors}
      onChanged={(inspection, message) => changed(message, inspection)}
      onRemoved={() => {
        query.set({ inspection: null }, "replace");
        changed("Inspection removed");
      }}
    />
  ) : openError ? (
    <Card className="flex flex-col items-start gap-3">
      <ErrorMessage message={openError} />
      <Button
        variant="secondary"
        onClick={() => {
          setDetailError(null);
          setDetailAttempt((current) => current + 1);
        }}
      >
        Try again
      </Button>
    </Card>
  ) : inspectionId ? (
    <Card>
      <Loading>Opening the inspection…</Loading>
    </Card>
  ) : null;

  const detailOpen = adding || inspectionId !== "";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Inspections</h1>
          <p className="text-muted">Plan kitchen hygiene inspections, and approve the scored reports before restaurants see them.</p>
        </div>
        {admin && !adding && <Button onClick={() => query.set({ new: "1", inspection: null })}>Plan an inspection</Button>}
      </div>

      {/* On a narrow screen an open inspection takes the place of the filter as well as the list. */}
      <div className={detailOpen ? "hidden lg:block" : "block"}>
        <ToggleGroup
          label="Which inspections to show"
          value={show}
          options={[
            { value: "all", label: "All", count: matching.all.length },
            { value: "review", label: "To approve", count: matching.review.length },
            { value: "todo", label: "To do", count: matching.todo.length },
            { value: "approved", label: "Approved", count: matching.approved.length },
          ]}
          onChange={(value) => query.set({ show: value === "all" ? null : value }, "replace")}
        />
      </div>

      <MasterDetail
        detail={detailPanel}
        detailLabel={adding ? "Plan an inspection" : "Inspection details"}
        placeholder="Select an inspection to read its report, approve it or change it."
        backHref={query.hrefWith({ inspection: null, new: null })}
        onBack={() => query.set({ inspection: null, new: null })}
        list={
          <>
            {listError && (
              <div className="flex flex-col items-start gap-3">
                <ErrorMessage message={listError} />
                <Button variant="secondary" onClick={() => setVersion((current) => current + 1)}>
                  Try again
                </Button>
              </div>
            )}
            {list === null && !listError && <Loading />}
            {list?.length === 0 && <p className="text-muted">No inspections yet.</p>}
            {list && list.length > 0 && shown.length === 0 && (
              <p role="status" className="text-sm text-muted">
                No inspections match this filter.
              </p>
            )}
            <ul className="flex flex-col gap-2">
              {shown.map((inspection) => {
                const selected = inspection.id === inspectionId;
                const opening = selected && !open && !openError;
                const score = scoreLine(inspection);
                return (
                  <li key={inspection.id}>
                    <a
                      href={query.hrefWith({ inspection: inspection.id, new: null })}
                      onClick={(event) => {
                        if (!isPlainClick(event)) return;
                        event.preventDefault();
                        if (!selected) query.set({ inspection: inspection.id, new: null });
                      }}
                      aria-current={selected ? "true" : undefined}
                      aria-busy={opening || undefined}
                      className={`block rounded-xl border bg-surface p-4 hover:border-primary ${
                        selected ? "border-primary ring-2 ring-primary" : "border-border"
                      }`}
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span className="font-semibold">
                          {inspection.organizationName} · {inspection.outletName}
                        </span>
                        <StatusBadge status={inspection.status} />
                      </span>
                      {score && (
                        <span className={`mt-1 block text-sm font-semibold ${inspection.grade ? GRADE[inspection.grade].style : ""}`}>{score}</span>
                      )}
                      <span className="mt-2 block text-sm text-muted">
                        {shortDay(inspection.date)} · {inspection.supervisorName}
                        {inspection.status === "IN_PROGRESS" ? ` · ${inspection.answered} of ${inspection.total} checks answered` : ""}
                        {inspection.nonCompliant > 0 ? ` · ${inspection.nonCompliant} not compliant` : ""}
                        {inspection.reportNumber ? ` · ${inspection.reportNumber}` : ""}
                      </span>
                      {opening && (
                        <span role="status" className="mt-2 block text-sm font-semibold text-primary">
                          Opening…
                        </span>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          </>
        }
      />
    </div>
  );
}

/** The day and the person: used to plan an inspection and to change one that has not started. */
function WhenAndWho({
  date,
  supervisorId,
  supervisors,
  dateError,
  onChange,
}: {
  date: string;
  supervisorId: string;
  supervisors: SupervisorDto[];
  dateError?: string;
  onChange: (next: { date?: string; supervisorId?: string }) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Date" name="date" type="date" required min={today()} value={date} error={dateError} onChange={(e) => onChange({ date: e.target.value })} />
      <SelectField
        label="Carried out by"
        name="supervisorId"
        value={supervisorId}
        hint="They answer the checks in the mobile app."
        onChange={(e) => onChange({ supervisorId: e.target.value })}
      >
        <option value="">Myself</option>
        {supervisors.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </SelectField>
    </div>
  );
}

function PlanInspection({
  supervisors,
  onDone,
  onCancel,
}: {
  supervisors: SupervisorDto[];
  onDone: (inspection: InspectionDto) => void;
  onCancel: () => void;
}) {
  const [outlets, setOutlets] = useState<InspectionOutletDto[] | null>(null);
  const [outletId, setOutletId] = useState("");
  const [date, setDate] = useState(today());
  const [supervisorId, setSupervisorId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    api.inspections
      .outlets()
      .then(setOutlets)
      .catch((e) => setError(describe(e)));
  }, []);

  async function plan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: FieldErrors = {};
    if (!outletId) found.outletId = "Choose an outlet.";
    const dateError = checkDate(date);
    if (dateError) found.date = dateError;
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(event.currentTarget, found);

    setBusy(true);
    setError(null);
    try {
      onDone(await api.inspections.start({ outletId, date, supervisorId: supervisorId || null }));
    } catch (e) {
      setError(describe(e));
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={plan} noValidate className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">Plan an inspection</h2>
        <p className="text-sm text-muted">
          The standard kitchen hygiene inspection: 92 checks in ten sections, scored out of 100.
        </p>
        {outlets === null && !error ? (
          <Loading />
        ) : (
          <SelectField label="Outlet" name="outletId" required value={outletId} error={errors.outletId} onChange={(e) => setOutletId(e.target.value)}>
            <option value="">Choose an outlet</option>
            {(outlets ?? []).map((outlet) => (
              <option key={outlet.id} value={outlet.id}>
                {outlet.organizationName} · {outlet.name}
              </option>
            ))}
          </SelectField>
        )}
        <WhenAndWho
          date={date}
          supervisorId={supervisorId}
          supervisors={supervisors}
          dateError={errors.date}
          onChange={(next) => {
            if (next.date !== undefined) setDate(next.date);
            if (next.supervisorId !== undefined) setSupervisorId(next.supervisorId);
          }}
        />
        <ErrorMessage message={error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy}>
            Plan the inspection
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function InspectionDetail({
  inspection,
  supervisors,
  onChanged,
  onRemoved,
}: {
  inspection: InspectionDto;
  supervisors: SupervisorDto[];
  onChanged: (inspection: InspectionDto, message: string) => void;
  onRemoved: () => void;
}) {
  const confirm = useConfirm();
  const { user } = useSession();
  const [date, setDate] = useState(inspection.date);
  // "Myself" in the list stands for the person looking at the page.
  const [supervisorId, setSupervisorId] = useState(inspection.supervisorId === user?.id ? "" : inspection.supervisorId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  async function act(action: () => Promise<InspectionDto>, message: string) {
    setBusy(true);
    setError(null);
    try {
      onChanged(await action(), message);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const dateError = checkDate(date);
    const found: FieldErrors = dateError ? { date: dateError } : {};
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(event.currentTarget, found);
    void act(() => api.inspections.update(inspection.id, { date, supervisorId: supervisorId || user?.id || inspection.supervisorId }), "Inspection changed");
  }

  async function remove() {
    const sure = await confirm({
      title: "Remove this inspection?",
      body: `The inspection of ${inspection.outletName} planned for ${shortDay(inspection.date)} will be taken off ${inspection.supervisorName}'s list.`,
      confirmLabel: "Remove the inspection",
      cancelLabel: "Keep the inspection",
    });
    if (!sure) return;
    setBusy(true);
    setError(null);
    try {
      await api.inspections.remove(inspection.id);
      onRemoved();
    } catch (e) {
      setError(describe(e));
      setBusy(false);
    }
  }

  /** True once "Send back" is pressed: the box for what to correct is showing. */
  const [returning, setReturning] = useState(false);
  const [correction, setCorrection] = useState("");
  const [correctionError, setCorrectionError] = useState<string | null>(null);

  function sendBack(event: FormEvent) {
    event.preventDefault();
    const note = correction.trim();
    if (note.length < 3) {
      setCorrectionError("Say what needs correcting, so the Supervisor knows what to change.");
      return;
    }
    void act(() => api.inspections.sendBack(inspection.id, { note }), "Report sent back to the Supervisor");
  }

  const checks = inspection.sections.flatMap((section) => section.checks);
  const findings = checks.filter((check) => check.answer === "NON_COMPLIANT");
  const notApplicable = checks.filter((check) => check.answer === "NOT_APPLICABLE").length;
  const scored = inspection.overallScore !== null;
  const started = inspection.status !== "PLANNED";

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">
            {inspection.organizationName} · {inspection.outletName}
          </h2>
          {inspection.outletAddress && <p className="text-sm text-muted">{inspection.outletAddress}</p>}
          <p className="text-sm text-muted">
            {shortDay(inspection.date)} · {inspection.supervisorName}
            {inspection.completedAt ? ` · finished ${when(inspection.completedAt)}` : ""}
            {inspection.approvedAt ? ` · approved ${when(inspection.approvedAt)}` : ""}
          </p>
        </div>
        <StatusBadge status={inspection.status} />
      </div>

      {inspection.reportNumber && <p className="font-semibold">Inspection report {inspection.reportNumber}</p>}

      {inspection.correctionNote && (
        <p className="rounded-lg border border-border p-3 text-sm">
          <span className="font-semibold">Sent back for correction:</span> {inspection.correctionNote}
        </p>
      )}

      {inspection.canReview && (
        <div className="flex flex-col gap-3 rounded-lg border border-danger p-3">
          <p className="text-sm">
            {inspection.supervisorName} has finished this inspection. Check the report below. Approving makes it final and shows it to the
            restaurant&apos;s Owner and Manager; if something is wrong, send it back to be corrected.
          </p>
          <ErrorMessage message={error} />
          {returning ? (
            <form onSubmit={sendBack} noValidate className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-sm font-medium">
                What should {inspection.supervisorName} correct?
                <span className="font-normal text-muted">
                  They will see this in the app, change the answers and finish the inspection again. The report keeps its number.
                </span>
                <textarea
                  value={correction}
                  onChange={(e) => {
                    setCorrection(e.target.value);
                    setCorrectionError(null);
                  }}
                  maxLength={500}
                  rows={3}
                  autoFocus
                  aria-invalid={correctionError ? true : undefined}
                  className="rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal"
                />
              </label>
              <ErrorMessage message={correctionError} />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" loading={busy}>
                  Send back to the Supervisor
                </Button>
                <Button type="button" variant="secondary" disabled={busy} onClick={() => setReturning(false)}>
                  Keep it here
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button type="button" loading={busy} onClick={() => void act(() => api.inspections.approve(inspection.id), "Report approved. The restaurant can now read it")}>
                Approve the report
              </Button>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => setReturning(true)}>
                Send back to the Supervisor
              </Button>
            </div>
          )}
        </div>
      )}

      {inspection.canManage && (
        <form onSubmit={save} noValidate className="flex flex-col gap-3">
          <WhenAndWho
            date={date}
            supervisorId={supervisorId}
            supervisors={supervisors}
            dateError={errors.date}
            onChange={(next) => {
              if (next.date !== undefined) setDate(next.date);
              if (next.supervisorId !== undefined) setSupervisorId(next.supervisorId);
            }}
          />
          <ErrorMessage message={error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy}>
              Save changes
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void remove()}>
              Remove the inspection
            </Button>
          </div>
          <p className="text-sm text-muted">It can be moved or removed until the first check is answered.</p>
        </form>
      )}

      {!started && !inspection.canManage && <p className="text-sm text-muted">Not started yet.</p>}

      {inspection.status === "IN_PROGRESS" && (
        <p className="text-sm">
          {inspection.complete} of {inspection.total} checks done. The scores below are from the answers so far.
        </p>
      )}

      {scored && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg bg-background p-4">
          <p className="text-4xl font-bold">
            {inspection.overallScore}
            <span className="text-base font-normal text-muted"> out of 100</span>
          </p>
          {inspection.grade && <p className={`text-lg font-bold ${GRADE[inspection.grade].style}`}>{GRADE[inspection.grade].label}</p>}
        </div>
      )}

      {started && (
        <>
          {inspection.criticalFailed > 0 && (
            <p className="text-sm font-semibold text-danger">
              {inspection.criticalFailed} critical check{inspection.criticalFailed === 1 ? "" : "s"} failed. A failed critical check means no grade, whatever the score.
            </p>
          )}
          <p className="text-sm text-muted">
            {checks.filter((check) => check.answer === "COMPLIANT").length} compliant · {findings.length} not compliant · {notApplicable} not applicable
            {inspection.answered < inspection.total ? ` · ${inspection.total - inspection.answered} not answered yet` : ""}
          </p>

          <section className="flex flex-col gap-2">
            <h3 className="font-bold">Section scores</h3>
            <table className="w-full text-sm">
              <thead className="sr-only">
                <tr>
                  <th scope="col">Section</th>
                  <th scope="col">Score out of 100</th>
                  <th scope="col">Marks</th>
                </tr>
              </thead>
              <tbody>
                {inspection.sections.map((section) => (
                  <tr key={section.key} className="border-t border-border">
                    <th scope="row" className="py-2 pr-3 text-left font-normal">
                      {section.key}. {section.title}
                      {/* The bar only helps comparing sections at a glance; the number beside it is the score. */}
                      <span aria-hidden className="mt-1 block h-1.5 overflow-hidden rounded-full bg-background">
                        <span className="block h-full rounded-full bg-primary" style={{ width: `${section.score ?? 0}%` }} />
                      </span>
                    </th>
                    <td className="py-2 pr-3 text-right align-top font-semibold whitespace-nowrap">{section.score ?? "Nothing applied"}</td>
                    <td className="py-2 text-right align-top whitespace-nowrap text-muted">
                      {section.earned} of {section.possible} marks
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted">
              Each check carries 2 marks and a critical check 4. Checks that do not apply are left out. A+ is 88 or more, A is 80 to 87, B is 68 to 79; below 68, or with a critical check failed, there is no grade.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="font-bold">Non-compliances ({findings.length})</h3>
            {findings.length === 0 && <p className="text-sm text-muted">None found.</p>}
            {findings.map((check) => (
              <Finding key={check.itemId} check={check} />
            ))}
          </section>
        </>
      )}

      {/* When nothing else showed the failure (the buttons above have their own place for it). */}
      {!inspection.canReview && !inspection.canManage && <ErrorMessage message={error} />}
    </Card>
  );
}

function Finding({ check }: { check: InspectionCheckDto }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
      <p className="font-semibold">
        {check.number}. {english(check.label)}
      </p>
      <p className="font-semibold text-danger">
        {[check.critical ? "Critical check" : null, check.severity ? `Severity: ${SEVERITY[check.severity]}` : "Severity not chosen yet"]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {check.note && <p className="whitespace-pre-wrap">{check.note}</p>}
      <p>
        <span className="font-semibold">Corrective action:</span> {check.correctiveAction ?? "Not written yet"}
      </p>
      <p>
        <span className="font-semibold">Fix by:</span> {check.dueDate ? shortDay(check.dueDate) : "No date yet"}
      </p>
      {check.photos.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {check.photos.map((photo, index) => (
            <a key={photo.id} href={api.fileUrl(photo.path)} target="_blank" rel="noreferrer">
              {/* Photos come from the API through short-lived links, so the plain image tag is used. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={api.fileUrl(photo.path)}
                alt={`Photo ${index + 1} of ${check.photos.length} for check ${check.number}`}
                className="h-40 w-full rounded-lg object-cover"
              />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
