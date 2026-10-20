"use client";

import {
  AUTO_LABELS,
  BLOOD_GROUPS,
  DOCUMENT_STATUS_WORDS,
  EDUCATION_LABELS,
  EDUCATION_LEVELS,
  expiryWords,
  ID_TYPE_LABELS,
  ID_TYPES,
  joiningDetailsSchema,
  joiningMessage,
  OWNER_LABELS,
  ONBOARDING_OWNERS,
  parseLegalMarkdown,
  personTaskSchema,
  RELATIONS,
  UNIFORM_SIZES,
  whatsappReminderUrl,
  type AppointmentLetterDto,
  type JoiningDetails,
  type JoiningDetailsInput,
  type JoiningDocumentDto,
  type JoiningFileDto,
  type LegalInline,
  type OnboardingDto,
  type OnboardingOwner,
  type OnboardingPhase,
  type OnboardingTaskDto,
  type PersonOnboardingDto,
  type TeamMemberDto,
} from "@eccs/shared";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { Button, ErrorMessage, Field, SelectField, TextAreaField } from "@/components/ui";
import { api } from "@/lib/api";
import { checkAgainst, focusFirstError, hasErrors, type FieldErrors } from "@/lib/forms";
import { describe, longDay, today, when } from "@/lib/format";

import { dayMonth, Panel, saveFile, Sheet } from "../finance/finance-parts";

// Onboarding a new team member (16 Oct 2026): the pieces the member's page, the new hire's own
// "Joining ECCS" page and the templates page share. The checklist; the joining file and its
// form; the documents; the appointment letter; the staff handbook.
//
// PATTERN FOLLOWED: BambooHR's and Keka's onboarding tab (a progress count, tasks by phase each
// with its owner and due date, late ones said in words, one-off tasks added to one person);
// Dayforce's onboarding summary (done and late counted apart); greytHR's and Keka's document
// review (each document accepted or sent back with a reason; HR can upload for the hire);
// accordions that open one section at a time (Nielsen Norman Group on accordions; Material's
// expansion panels). Colour is never alone: every state is also in words.

const GREEN = "#2E7D32";
const AMBER = "#B26A00";

/** Opens a file the server sent (a document, the letter) in a new tab, or saves it when the browser will not open one. */
export async function openFile(fetchBlob: () => Promise<Blob>, name: string, onError: (message: string) => void) {
  // The tab is opened at once, while the click still counts as the person's own, then filled when the file arrives.
  const tab = window.open("", "_blank");
  try {
    const blob = await fetchBlob();
    const url = URL.createObjectURL(blob);
    if (tab) tab.location.href = url;
    else saveFile(blob, name);
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (e) {
    tab?.close();
    onError(describe(e));
  }
}

// ───────────────────────── Tasks ─────────────────────────

/** The round mark before a task: ticked, waiting, or late, said in words for screen readers too. */
function Mark({ task }: { task: OnboardingTaskDto }) {
  const done = task.done;
  return (
    <span
      aria-hidden
      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold text-white"
      style={done ? { background: GREEN, borderColor: GREEN } : { borderColor: task.daysLate > 0 ? AMBER : "#9AA1AB" }}
    >
      {done ? "✓" : ""}
    </span>
  );
}

/** "Ops Manager · 2 days late", "You · Due Mon 19 Oct", "Done by the app, 16 Oct". */
function taskMeta(task: OnboardingTaskDto, you: boolean) {
  const owner = you && task.owner === "NEW_HIRE" ? "You" : OWNER_LABELS[task.owner];
  if (task.done) return [owner, `done${task.doneBy ? ` by ${task.doneBy}` : ""}${task.doneAt ? `, ${when(task.doneAt)}` : ""}`].join(" · ");
  return [owner, task.dueWords, task.auto ? "ticks itself" : null, task.required ? null : "optional"].filter(Boolean).join(" · ");
}

/**
 * One task: a mark that ticks it (when this person may), its title, who does it and when, and
 * its note. The menu holds the note and Remove.
 */
export function TaskRow({
  task,
  you = false,
  canRemove = false,
  onTick,
  onNote,
  onRemove,
}: {
  task: OnboardingTaskDto;
  you?: boolean;
  canRemove?: boolean;
  onTick: (task: OnboardingTaskDto, done: boolean) => Promise<void>;
  onNote?: (task: OnboardingTaskDto, note: string | null) => Promise<void>;
  onRemove?: (task: OnboardingTaskDto) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [noting, setNoting] = useState(false);
  const late = !task.done && task.daysLate > 0;
  const tick = async () => {
    setBusy(true);
    try {
      await onTick(task, !task.done);
    } finally {
      setBusy(false);
    }
  };
  const label = `${task.done ? "Untick" : "Tick"}: ${task.title}`;
  return (
    <li className="flex flex-col gap-1 py-2.5">
      <div className="flex items-start gap-3">
        {task.canTick ? (
          <button type="button" disabled={busy} aria-pressed={task.done} aria-label={label} title={label} onClick={() => void tick()} className="cursor-pointer rounded-full disabled:opacity-50">
            <Mark task={task} />
          </button>
        ) : (
          <span title={task.auto && !task.done ? `Ticks itself when ${AUTO_LABELS[task.auto]}` : undefined}>
            <Mark task={task} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium ${task.done ? "text-muted line-through decoration-1" : ""}`}>{task.title}</p>
          {/* Who and when, then the small actions on the same line, so the title keeps the whole width on a phone. */}
          <p className="flex flex-wrap items-center gap-x-2 text-xs">
            <span className={late ? "font-semibold" : "text-muted"} style={late ? { color: "#8A5300" } : undefined}>
              {taskMeta(task, you)}
            </span>
            {onNote && task.canTick && (
              <button type="button" className="cursor-pointer font-semibold text-primary hover:underline" onClick={() => setNoting((value) => !value)}>
                {task.note ? "Change note" : "Add note"}
                <span className="sr-only"> to {task.title}</span>
              </button>
            )}
            {canRemove && onRemove && (
              <button type="button" className="cursor-pointer font-semibold text-danger hover:underline" onClick={() => void onRemove(task)}>
                Remove<span className="sr-only"> {task.title}</span>
              </button>
            )}
          </p>
          {task.note && !noting && <p className="text-xs text-muted">Note: {task.note}</p>}
        </div>
      </div>
      {noting && onNote && (
        <NoteForm
          task={task}
          onSave={async (note) => {
            await onNote(task, note);
            setNoting(false);
          }}
          onCancel={() => setNoting(false)}
        />
      )}
    </li>
  );
}

function NoteForm({ task, onSave, onCancel }: { task: OnboardingTaskDto; onSave: (note: string | null) => Promise<void>; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = String(new FormData(event.currentTarget).get("note") ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      await onSave(note || null);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(event) => void save(event)} className="ml-8 flex flex-wrap items-end gap-2">
      <Field label="Note" name="note" maxLength={140} defaultValue={task.note ?? ""} wrapperClassName="min-w-0 flex-1" plainLabel autoFocus />
      <Button type="submit" size="sm" loading={busy}>
        Save
      </Button>
      <Button type="button" size="sm" variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
      {error && <p className="w-full text-sm font-semibold text-danger">{error}</p>}
    </form>
  );
}

/** "9 of 16 done · 2 late", with a bar. */
export function ProgressLine({ done, total, late }: { done: number; total: number; late?: number }) {
  const share = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm">
        <b>
          {done} of {total} done
        </b>
        {late ? (
          <span className="font-semibold" style={{ color: "#8A5300" }}>
            {" "}
            · {late} late
          </span>
        ) : null}
      </p>
      <div aria-hidden className="h-2 overflow-hidden rounded-full bg-background">
        <div className="h-full rounded-full" style={{ width: `${share}%`, background: GREEN }} />
      </div>
    </div>
  );
}

/**
 * The checklist on a member's Team page: progress, the next few tasks due, then the phases,
 * one open at a time (the current one first). Done, it folds into one line.
 */
export function ChecklistPanel({ data, member, onChange }: { data: OnboardingDto; member: TeamMemberDto; onChange: (next: PersonOnboardingDto) => void }) {
  const notify = useToast();
  const confirm = useConfirm();
  // The phases start folded: "Next" already shows what is due, so the page stays short.
  const [open, setOpen] = useState<OnboardingPhase | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [adding, setAdding] = useState(false);
  const headingId = useId();
  const userId = member.userId;

  const run = async (work: () => Promise<PersonOnboardingDto>, done?: string) => {
    try {
      onChange(await work());
      if (done) notify(done);
    } catch (e) {
      notify(describe(e));
    }
  };
  const onTick = (task: OnboardingTaskDto, done: boolean) => run(() => api.onboarding.tick(userId, task.id, { done }));
  const onNote = (task: OnboardingTaskDto, note: string | null) => run(() => api.onboarding.tick(userId, task.id, { done: task.done, note }), "Note saved");
  const onRemove = async (task: OnboardingTaskDto) => {
    const sure = await confirm({ title: `Remove "${task.title}"?`, body: "It comes off this person's checklist only; the template stays as it is.", confirmLabel: "Remove the task", cancelLabel: "Keep it" });
    if (sure) await run(() => api.onboarding.removeTask(userId, task.id), "Task removed");
  };
  const sendLink = () => {
    const text = joiningMessage({ name: member.name, consoleUrl: window.location.origin, phone: member.phone, joinedOn: data.joinedOn, today: today() });
    window.open(whatsappReminderUrl(member.isSample ? null : member.phone, text), "_blank", "noopener");
    if (member.isSample) notify("A sample team member: the number is made up, so WhatsApp asks whom to write to.");
  };
  // "Next" only ticks; the note and Remove are in the phases, so the top of the panel stays plain.
  const rows = (tasks: readonly OnboardingTaskDto[], actions = true) => (
    <ul className="flex flex-col divide-y divide-border">
      {tasks.map((task) =>
        actions ? (
          <TaskRow key={task.id} task={task} canRemove={data.canEdit} onTick={onTick} onNote={onNote} onRemove={onRemove} />
        ) : (
          <TaskRow key={task.id} task={task} onTick={onTick} />
        ),
      )}
    </ul>
  );

  const doneOn = data.progress.doneOn;
  if (doneOn && !showDone) {
    return (
      <section aria-labelledby={headingId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-5 py-3">
        <p id={headingId} className="flex items-center gap-2 text-sm font-semibold">
          <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full text-xs text-white" style={{ background: GREEN }}>
            ✓
          </span>
          Onboarding done on {dayMonth(doneOn)}
        </p>
        <Button variant="link" className="text-sm" onClick={() => setShowDone(true)}>
          Show the checklist
        </Button>
      </section>
    );
  }

  return (
    <Panel
      title="Onboarding"
      description={`Started ${dayMonth(data.startedOn)}`}
      action={
        <span className="flex flex-wrap gap-1">
          {!doneOn && (
            <Button variant="link" className="text-sm" onClick={sendLink}>
              Send joining link
            </Button>
          )}
          {data.canEdit && (
            <Button variant="link" className="text-sm" onClick={() => setAdding(true)}>
              Add a task
            </Button>
          )}
          {doneOn && (
            <Button variant="link" className="text-sm" onClick={() => setShowDone(false)}>
              Fold away
            </Button>
          )}
        </span>
      }
    >
      <ProgressLine {...data.progress} />
      {data.next.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Next</h3>
          {rows(data.next, false)}
        </div>
      )}
      <div className="flex flex-col divide-y divide-border border-t border-border">
        {data.phases.map((phase) => {
          const expanded = open === phase.phase;
          return (
            <div key={phase.phase}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : phase.phase)}
                className="flex w-full cursor-pointer items-center justify-between gap-3 py-2.5 text-left"
              >
                <span className="flex items-center gap-2 font-semibold">
                  <span aria-hidden className="text-muted">
                    {expanded ? "▾" : "▸"}
                  </span>
                  {phase.label}
                </span>
                <span className="text-sm text-muted">
                  {phase.done} of {phase.total}
                  {phase.late > 0 && (
                    <span className="font-semibold" style={{ color: "#8A5300" }}>
                      {" "}
                      · {phase.late} late
                    </span>
                  )}
                </span>
              </button>
              {expanded && <div className="pb-2 pl-6">{rows(phase.tasks)}</div>}
            </div>
          );
        })}
      </div>
      <AddTaskSheet open={adding} member={member} joinedOn={data.joinedOn} onClose={() => setAdding(false)} onSaved={onChange} />
    </Panel>
  );
}

function AddTaskSheet({ open, member, joinedOn, onClose, onSaved }: { open: boolean; member: TeamMemberDto; joinedOn: string; onClose: () => void; onSaved: (next: PersonOnboardingDto) => void }) {
  return (
    <Sheet open={open} title={`A task for ${member.name}`} onClose={onClose}>
      {open && <AddTaskForm member={member} joinedOn={joinedOn} onClose={onClose} onSaved={onSaved} />}
    </Sheet>
  );
}

function AddTaskForm({ member, joinedOn, onClose, onSaved }: { member: TeamMemberDto; joinedOn: string; onClose: () => void; onSaved: (next: PersonOnboardingDto) => void }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const input = { title: String(values.get("title") ?? "").trim(), owner: String(values.get("owner")) as OnboardingOwner, dueOn: String(values.get("dueOn") ?? ""), required: values.get("required") === "on" };
    const found = checkAgainst(personTaskSchema, input);
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.onboarding.addTask(member.userId, input));
      notify("Task added");
      onClose();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(event) => void save(event)} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-muted">For this person only. The role&apos;s template stays as it is.</p>
      <Field label="Task" name="title" required maxLength={120} error={errors.title} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Who does it" name="owner" defaultValue="OPS_MANAGER" error={errors.owner}>
          {ONBOARDING_OWNERS.map((owner) => (
            <option key={owner} value={owner}>
              {OWNER_LABELS[owner]}
            </option>
          ))}
        </SelectField>
        <Field label="Due" name="dueOn" type="date" required defaultValue={joinedOn > today() ? joinedOn : today()} error={errors.dueOn} />
      </div>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="required" defaultChecked className="h-4 w-4 accent-primary" />
        Must be done before onboarding is done
      </label>
      <ErrorMessage message={error} />
      <div className="flex gap-2 border-t border-border pt-4">
        <Button type="submit" loading={busy}>
          Add the task
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ───────────────────────── The joining file ─────────────────────────

const relationLabel = (details: Pick<JoiningDetails, "emergencyName" | "emergencyRelation" | "emergencyPhone">) =>
  details.emergencyName ? [`${details.emergencyName}${details.emergencyRelation ? ` (${details.emergencyRelation})` : ""}`, details.emergencyPhone?.replace(/^\+91/, "")].filter(Boolean).join(", ") : null;

/** The joining file as a short list; the account number and PAN masked. */
export function FileSummary({ file }: { file: JoiningFileDto }) {
  const d = file.shown;
  const entries: [string, ReactNode | null][] = [
    ["Date of birth", d.dateOfBirth ? longDay(d.dateOfBirth) : null],
    ["Father's or mother's name", d.parentName],
    ["Address", d.currentAddress],
    ["Permanent address", d.permanentSame ? "Same" : d.permanentAddress],
    ["Emergency contact", relationLabel(d)],
    ["Uniform size", d.uniformSize],
    ["Blood group", d.bloodGroup],
    ["ID proof", d.idType ? `${ID_TYPE_LABELS[d.idType]}${d.idLast4 ? ` ending ${d.idLast4}` : ""}` : null],
    ["PAN", d.pan],
    ["Bank account", d.bankAccount ? [d.bankHolder, d.bankAccount, d.bankIfsc].filter(Boolean).join(" · ") : null],
    ["Previous employer", d.previousEmployer],
    ["UAN / ESI", [d.uan ? `UAN ${d.uan}` : null, d.esiNumber ? `ESI ${d.esiNumber}` : null].filter(Boolean).join(" · ") || null],
    ["Education", d.education ? EDUCATION_LABELS[d.education] : null],
  ];
  const shown = entries.filter(([, value]) => value);
  return (
    <div className="flex flex-col gap-3">
      {file.missing.length > 0 && (
        <p className="text-sm">
          <b style={{ color: "#8A5300" }}>Still to fill in:</b> {file.missing.join(", ")}
        </p>
      )}
      {shown.length > 0 ? (
        <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[11rem_minmax(0,1fr)]">
          {shown.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted">Nothing filled in yet.</p>
      )}
      {file.updatedAt && (
        <p className="text-xs text-muted">
          Last saved {when(file.updatedAt)}
          {file.updatedBy ? ` by ${file.updatedBy}` : ""}
        </p>
      )}
    </div>
  );
}

/**
 * The joining file's form, for the new hire or the Super Admin on their behalf. Saved even
 * half-filled. The Super Admin's form shows the whole account number and PAN; the new hire's
 * leaves them empty (saved, they show as "•••• 4821") and keeps them unless typed again.
 * PATTERN FOLLOWED: greytHR's onboarding form (personal, address, emergency contact, ID and
 * statutory, bank, previous employment, education), in short groups on one page.
 */
export function JoiningForm({
  values,
  masks,
  saveLabel = "Save",
  onSave,
  onCancel,
}: {
  /** What to fill the form with. */
  values: JoiningDetails;
  /** For the new hire: the saved account number and PAN, masked, shown as hints. */
  masks?: { bankAccount: string | null; pan: string | null };
  saveLabel?: string;
  onSave: (input: JoiningDetailsInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [same, setSame] = useState(values.permanentSame !== false);
  const formRef = useRef<HTMLFormElement>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    const input: Record<string, unknown> = {
      dateOfBirth: text("dateOfBirth"),
      parentName: text("parentName"),
      currentAddress: text("currentAddress"),
      permanentSame: same,
      permanentAddress: same ? "" : text("permanentAddress"),
      emergencyName: text("emergencyName"),
      emergencyRelation: text("emergencyRelation"),
      emergencyPhone: text("emergencyPhone"),
      bloodGroup: text("bloodGroup"),
      uniformSize: text("uniformSize"),
      idType: text("idType"),
      idLast4: text("idLast4"),
      bankHolder: text("bankHolder"),
      bankIfsc: text("bankIfsc"),
      previousEmployer: text("previousEmployer"),
      uan: text("uan"),
      esiNumber: text("esiNumber"),
      education: text("education"),
    };
    // The account number and the PAN: left empty on the new hire's form, they are kept as saved.
    for (const key of ["bankAccount", "pan"] as const) {
      if (!masks || text(key)) input[key] = text(key);
    }
    if (input.bankAccount !== undefined) input.bankAccountAgain = text("bankAccountAgain");
    const found = checkAgainst(joiningDetailsSchema, input);
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);
    setBusy(true);
    setError(null);
    try {
      await onSave(input as JoiningDetailsInput);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  const group = (title: string, children: ReactNode, hint?: string) => (
    <fieldset className="flex flex-col gap-3 border-t border-border pt-4 first:border-0 first:pt-0">
      <legend className="sr-only">{title}</legend>
      <div>
        <p className="font-bold">{title}</p>
        {hint && <p className="text-sm text-muted">{hint}</p>}
      </div>
      {children}
    </fieldset>
  );
  const choose = (list: readonly string[], labels?: Record<string, string>) => (
    <>
      <option value="">Choose…</option>
      {list.map((value) => (
        <option key={value} value={value}>
          {labels?.[value] ?? value}
        </option>
      ))}
    </>
  );

  return (
    <form ref={formRef} onSubmit={(event) => void save(event)} noValidate className="flex flex-col gap-4">
      {group(
        "About you",
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date of birth" name="dateOfBirth" type="date" required max={today()} defaultValue={values.dateOfBirth ?? ""} error={errors.dateOfBirth} />
          <Field label="Father's or mother's name" name="parentName" maxLength={80} defaultValue={values.parentName ?? ""} error={errors.parentName} />
        </div>,
      )}
      {group(
        "Address",
        <>
          <TextAreaField label="Where you live now" name="currentAddress" required rows={2} maxLength={300} defaultValue={values.currentAddress ?? ""} error={errors.currentAddress} />
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={same} onChange={(event) => setSame(event.target.checked)} className="h-4 w-4 accent-primary" />
            My permanent address is the same
          </label>
          {!same && <TextAreaField label="Permanent address" name="permanentAddress" required rows={2} maxLength={300} defaultValue={values.permanentAddress ?? ""} error={errors.permanentAddress} />}
        </>,
      )}
      {group(
        "Emergency contact",
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name" name="emergencyName" required maxLength={80} defaultValue={values.emergencyName ?? ""} error={errors.emergencyName} />
          <SelectField label="Relation" name="emergencyRelation" defaultValue={values.emergencyRelation ?? ""} error={errors.emergencyRelation}>
            {choose(RELATIONS)}
          </SelectField>
          <Field label="Mobile number" name="emergencyPhone" type="tel" inputMode="numeric" required defaultValue={values.emergencyPhone?.replace(/^\+91/, "") ?? ""} error={errors.emergencyPhone} />
        </div>,
      )}
      {group(
        "Uniform and safety",
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Uniform size" name="uniformSize" defaultValue={values.uniformSize ?? ""} error={errors.uniformSize}>
            {choose(UNIFORM_SIZES)}
          </SelectField>
          <SelectField label="Blood group (optional)" name="bloodGroup" defaultValue={values.bloodGroup ?? ""} hint="For first aid on a site" error={errors.bloodGroup}>
            {choose(BLOOD_GROUPS)}
          </SelectField>
        </div>,
      )}
      {group(
        "ID proof",
        <>
          <div className="grid grid-cols-2 gap-3">
            <SelectField label="Which ID" name="idType" defaultValue={values.idType ?? ""} error={errors.idType}>
              {choose(ID_TYPES, ID_TYPE_LABELS)}
            </SelectField>
            <Field label="Its last 4 digits" name="idLast4" required inputMode="numeric" maxLength={14} autoComplete="off" defaultValue={values.idLast4 ?? ""} error={errors.idLast4} />
          </div>
          <Field
            label="PAN"
            name="pan"
            maxLength={12}
            autoComplete="off"
            className="uppercase"
            defaultValue={values.pan ?? ""}
            hint={masks?.pan ? `Saved: ${masks.pan}. Leave empty to keep it.` : "If you have one"}
            error={errors.pan}
          />
        </>,
        "Only the last 4 digits. ECCS never keeps a whole Aadhaar number.",
      )}
      {group(
        "Bank account for your salary",
        <>
          <Field label="Account holder's name" name="bankHolder" required maxLength={80} defaultValue={values.bankHolder ?? ""} error={errors.bankHolder} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Account number"
              name="bankAccount"
              required={!masks?.bankAccount}
              inputMode="numeric"
              autoComplete="off"
              defaultValue={values.bankAccount ?? ""}
              hint={masks?.bankAccount ? `Saved: ${masks.bankAccount}. Leave empty to keep it.` : undefined}
              error={errors.bankAccount}
            />
            <Field label="Account number again" name="bankAccountAgain" required={!masks?.bankAccount} inputMode="numeric" autoComplete="off" defaultValue={values.bankAccount ?? ""} error={errors.bankAccountAgain} />
          </div>
          <Field label="IFSC" name="bankIfsc" required maxLength={14} autoComplete="off" className="uppercase" hint="On your cheque book or passbook, for example SBIN0001234" defaultValue={values.bankIfsc ?? ""} error={errors.bankIfsc} />
        </>,
      )}
      {group(
        "Earlier work and education",
        <>
          <Field label="Previous employer" name="previousEmployer" maxLength={80} defaultValue={values.previousEmployer ?? ""} error={errors.previousEmployer} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="UAN" name="uan" inputMode="numeric" maxLength={14} hint="If you have one" defaultValue={values.uan ?? ""} error={errors.uan} />
            <Field label="ESI number" name="esiNumber" inputMode="numeric" maxLength={12} hint="If you have one" defaultValue={values.esiNumber ?? ""} error={errors.esiNumber} />
          </div>
          <SelectField label="Highest education (optional)" name="education" defaultValue={values.education ?? ""} error={errors.education}>
            {choose(EDUCATION_LEVELS, EDUCATION_LABELS)}
          </SelectField>
        </>,
      )}
      <ErrorMessage message={error} />
      <div className="sticky bottom-0 -mx-1 flex gap-2 border-t border-border bg-surface px-1 py-3">
        <Button type="submit" loading={busy}>
          {saveLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/** The Super Admin's joining file panel: the file at a glance, and its form (with the whole account number) in a panel from the right. */
export function FilePanel({ data, member, onChange }: { data: OnboardingDto; member: TeamMemberDto; onChange: (next: PersonOnboardingDto) => void }) {
  const notify = useToast();
  const [values, setValues] = useState<JoiningDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function edit() {
    setError(null);
    try {
      setValues(await api.onboarding.fullDetails(member.userId));
    } catch (e) {
      setError(describe(e));
    }
  }
  if (!data.file) return null;
  return (
    <Panel
      title="Joining file"
      description={data.file.complete ? "Complete" : "Filled in by them on their Joining ECCS page, or by you here"}
      action={
        <Button variant="link" className="text-sm" onClick={() => void edit()}>
          {data.file.updatedAt ? "Change" : "Fill in"}
        </Button>
      }
    >
      <FileSummary file={data.file} />
      <ErrorMessage message={error} />
      <Sheet open={values !== null} title={`${member.name}'s joining file`} onClose={() => setValues(null)} wide>
        {values && (
          <JoiningForm
            values={values}
            onCancel={() => setValues(null)}
            onSave={async (input) => {
              onChange(await api.onboarding.saveDetails(member.userId, input));
              notify("Joining file saved");
              setValues(null);
            }}
          />
        )}
      </Sheet>
    </Panel>
  );
}

// ───────────────────────── Documents ─────────────────────────

/**
 * A document's date and whether it is due (20 Oct 2026): "Runs out on Tue 3 Nov" quietly, or with a
 * mark and in bold once it is past or within 30 days; "Missing" for one expected and not on file.
 * Said in words, never by colour alone.
 */
function DateWords({ document }: { document: JoiningDocumentDto }) {
  const due = document.due;
  if (due?.state === "MISSING") return <DueLine danger>Missing</DueLine>;
  if (!document.expiresOn) return null;
  const words = expiryWords(document.expiresOn, today());
  if (!due) return <p className="text-xs text-muted">{words}</p>;
  return <DueLine danger={due.state === "EXPIRED"}>{`${words}: renew it`}</DueLine>;
}

function DueLine({ danger = false, children }: { danger?: boolean; children: ReactNode }) {
  return (
    <p className="text-xs font-semibold" style={{ color: danger ? "#B3261E" : "#8A5300" }}>
      <span aria-hidden>! </span>
      {children}
    </p>
  );
}

function StatusWords({ document }: { document: JoiningDocumentDto }) {
  const color = document.status === "ACCEPTED" ? GREEN : document.status === "SENT_BACK" ? "#B3261E" : document.status === "UPLOADED" ? "#2F6FD6" : "#5b6770";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color }}>
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: color }} />
      {DOCUMENT_STATUS_WORDS[document.status]}
    </span>
  );
}

/**
 * The documents asked for, each with where it stands and what can be done with it: the new
 * hire uploads (again, after one is sent back); the Super Admin opens, accepts, sends back with
 * a reason, or uploads on their behalf.
 */
export function DocumentList({
  documents,
  admin,
  onUpload,
  onOpen,
  onAccept,
  onSendBack,
  onSetDate,
}: {
  documents: readonly JoiningDocumentDto[];
  admin: boolean;
  onUpload: (document: JoiningDocumentDto, file: File) => Promise<void>;
  onOpen: (document: JoiningDocumentDto) => void;
  /** `expiresOn` left out keeps the date the server proposes; `null` is none. */
  onAccept?: (document: JoiningDocumentDto, expiresOn?: string | null) => Promise<void>;
  onSendBack?: (document: JoiningDocumentDto, reason: string) => Promise<void>;
  onSetDate?: (document: JoiningDocumentDto, expiresOn: string | null) => Promise<void>;
}) {
  // The required ones first; the optional ones after, under their own line.
  const row = (document: JoiningDocumentDto) => (
    <DocumentRow key={document.kind} document={document} admin={admin} onUpload={onUpload} onOpen={onOpen} onAccept={onAccept} onSendBack={onSendBack} onSetDate={onSetDate} />
  );
  const optional = documents.filter((document) => !document.required);
  return (
    <div className="flex flex-col">
      <ul className="flex flex-col divide-y divide-border">{documents.filter((document) => document.required).map(row)}</ul>
      {optional.length > 0 && (
        <>
          <p className="mt-2 border-t border-border pt-3 text-xs font-semibold tracking-wide text-muted uppercase">{admin ? "Optional" : "If you have them"}</p>
          <ul className="flex flex-col divide-y divide-border">{optional.map(row)}</ul>
        </>
      )}
    </div>
  );
}

/** Documents whose acceptance asks for the day they run out: medical fitness (a year on is offered) and police verification. */
const DATED_ON_ACCEPT: readonly JoiningDocumentDto["kind"][] = ["MEDICAL_FITNESS", "POLICE_VERIFICATION"];

function DocumentRow({
  document,
  admin,
  onUpload,
  onOpen,
  onAccept,
  onSendBack,
  onSetDate,
}: {
  document: JoiningDocumentDto;
  admin: boolean;
  onUpload: (document: JoiningDocumentDto, file: File) => Promise<void>;
  onOpen: (document: JoiningDocumentDto) => void;
  onAccept?: (document: JoiningDocumentDto, expiresOn?: string | null) => Promise<void>;
  onSendBack?: (document: JoiningDocumentDto, reason: string) => Promise<void>;
  onSetDate?: (document: JoiningDocumentDto, expiresOn: string | null) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // The date form, open to accept with a date or to change the date of one on file (20 Oct 2026).
  const [dating, setDating] = useState<"accept" | "change" | null>(null);
  const onFile = document.status === "UPLOADED" || document.status === "ACCEPTED";
  const uploadable = admin || document.status !== "ACCEPTED";
  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  };
  async function saveDate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // An empty box means the document does not run out.
    const value = String(new FormData(event.currentTarget).get("expiresOn") ?? "").trim() || null;
    await act(async () => {
      if (dating === "accept") await onAccept!(document, value);
      else await onSetDate!(document, value);
      setDating(null);
    });
  }
  async function sendBack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    if (reason.length < 3) return setError("Say why, so they know what to upload");
    await act(async () => {
      await onSendBack!(document, reason);
      setSending(false);
    });
  }
  return (
    <li className="flex flex-col gap-1.5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        {/* Wide enough that on a phone the buttons drop under the name rather than squeezing it. */}
        <div className="min-w-[11rem] flex-1">
          <p className="text-sm font-semibold">{document.label}</p>
          <StatusWords document={document} />
          {document.status === "SENT_BACK" && document.reason && <p className="text-sm">“{document.reason}”</p>}
          <DateWords document={document} />
          {/* How to get it is for the new hire; the Super Admin knows. */}
          {document.status === "WAITING" && !admin && <p className="text-xs text-muted">{document.hint}</p>}
        </div>
        <span className="flex max-w-full flex-wrap items-center gap-1">
          {document.documentId && (
            <Button variant="link" className="text-sm" onClick={() => onOpen(document)}>
              Open
            </Button>
          )}
          {admin && document.status === "UPLOADED" && onAccept && (
            <Button
              size="sm"
              loading={busy && dating === null}
              // Medical fitness and police verification are accepted with the day they run out, offered and editable.
              onClick={() => (DATED_ON_ACCEPT.includes(document.kind) ? setDating((value) => (value === "accept" ? null : "accept")) : void act(() => onAccept(document)))}
            >
              Accept
            </Button>
          )}
          {admin && onFile && onSetDate && dating === null && (
            <Button variant="link" className="text-sm" onClick={() => setDating("change")}>
              {document.expiresOn ? "Change date" : "Add a date"}
              <span className="sr-only"> of the {document.label}</span>
            </Button>
          )}
          {admin && (document.status === "UPLOADED" || document.status === "ACCEPTED") && onSendBack && (
            <Button size="sm" variant="secondary" onClick={() => setSending((value) => !value)}>
              Send back
            </Button>
          )}
          {uploadable &&
            (admin ? (
              // The Super Admin uploads for them now and then: a quiet link, the review buttons stay in front.
              <Button variant="link" className="text-sm" disabled={busy} onClick={() => input.current?.click()}>
                {document.status === "WAITING" || document.status === "SENT_BACK" ? "Upload for them" : "Replace"}
                <span className="sr-only"> {document.label}</span>
              </Button>
            ) : (
              <Button
                size="sm"
                variant={(document.status === "WAITING" || document.status === "SENT_BACK") && document.required ? "primary" : "secondary"}
                loading={busy && !sending}
                onClick={() => input.current?.click()}
              >
                {document.status === "WAITING" ? "Upload" : document.status === "SENT_BACK" ? "Upload again" : "Replace"}
                <span className="sr-only"> {document.label}</span>
              </Button>
            ))}
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void act(() => onUpload(document, file));
            }}
          />
        </span>
      </div>
      {sending && (
        <form onSubmit={(event) => void sendBack(event)} className="flex flex-wrap items-end gap-2">
          <Field label="Why" name="reason" maxLength={140} wrapperClassName="min-w-0 flex-1" plainLabel placeholder="Upload the masked Aadhaar" autoFocus />
          <Button type="submit" size="sm" variant="danger" loading={busy}>
            Send back
          </Button>
        </form>
      )}
      {dating && (
        <form onSubmit={(event) => void saveDate(event)} className="flex flex-wrap items-end gap-2">
          <Field
            label="Runs out on"
            name="expiresOn"
            type="date"
            min={document.uploadedAt?.slice(0, 10)}
            defaultValue={dating === "accept" ? (document.proposedExpiry ?? "") : (document.expiresOn ?? "")}
            hint={dating === "accept" && document.proposedExpiry ? "A year from the upload, as for food handlers. Empty if it does not run out." : "Empty if it does not run out."}
            wrapperClassName="min-w-0"
            plainLabel
            autoFocus
          />
          <Button type="submit" size="sm" loading={busy}>
            {dating === "accept" ? "Accept" : "Save the date"}
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setDating(null)}>
            Cancel
          </Button>
        </form>
      )}
      {error && <p className="text-sm font-semibold text-danger">{error}</p>}
    </li>
  );
}

/** The Super Admin's documents panel. */
export function DocumentsPanel({ data, member, onChange }: { data: OnboardingDto; member: TeamMemberDto; onChange: (next: PersonOnboardingDto) => void }) {
  const notify = useToast();
  if (!data.documents) return null;
  const required = data.documents.filter((entry) => entry.required);
  const accepted = required.filter((entry) => entry.status === "ACCEPTED").length;
  const toCheck = data.documents.filter((entry) => entry.status === "UPLOADED").length;
  const due = data.documents.filter((entry) => entry.due).length;
  return (
    // An id, so "Documents due" at the top of the page can lead here.
    <div id="documents" className="scroll-mt-20">
      <Panel
        title="Documents"
        description={[`${accepted} of ${required.length} required accepted`, toCheck > 0 ? `${toCheck} to check` : null, due > 0 ? `${due} due` : null].filter(Boolean).join(" · ")}
      >
        <DocumentList
          documents={data.documents}
          admin
          onUpload={async (document, file) => {
            onChange(await api.onboarding.uploadFor(member.userId, document.kind, file, file.name));
            notify(`${document.label} uploaded`);
          }}
          onOpen={(document) => void openFile(() => api.onboarding.documentFile(document.documentId!), `${document.label}${document.pdf ? ".pdf" : ""}`, notify)}
          onAccept={async (document, expiresOn) => {
            onChange(await api.onboarding.acceptDocument(document.documentId!, expiresOn === undefined ? {} : { expiresOn }));
            notify(`${document.label} accepted`);
          }}
          onSendBack={async (document, reason) => {
            onChange(await api.onboarding.sendBack(document.documentId!, reason));
            notify(`${document.label} sent back. Its file is deleted.`);
          }}
          onSetDate={async (document, expiresOn) => {
            onChange(await api.onboarding.setDocumentDate(document.documentId!, { expiresOn }));
            notify(expiresOn ? `${document.label}: date saved` : `${document.label}: date removed`);
          }}
        />
      </Panel>
    </div>
  );
}

// ───────────────────────── The appointment letter ─────────────────────────

/** "Waiting for Kiran to accept", "Accepted on 17 Oct by Kiran", "Signed on paper, recorded 17 Oct". */
export function letterStatusWords(letter: AppointmentLetterDto, name: string) {
  if (letter.status === "REPLACED") return `Replaced by ${letter.replacedBy ?? "a newer letter"}`;
  if (letter.status === "ACCEPTED") return letter.acceptedHow === "PAPER" ? `Signed on paper, recorded ${when(letter.acceptedAt!)}` : `Accepted ${when(letter.acceptedAt!)} by ${letter.acceptedBy ?? name}`;
  return `Waiting for ${name} to accept`;
}

/** The letter's text as the new hire reads it: the opening, the particulars, the closing. */
export function LetterText({ letter }: { letter: AppointmentLetterDto }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted">
        {letter.number} · {letter.particulars.madeOn}
      </p>
      <p>{letter.opening}</p>
      <dl className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {letter.rows.map((row) => (
          <div key={row.label} className="grid gap-0.5 px-3 py-2 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
            <dt className="font-semibold text-muted">{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      <p>{letter.closing}</p>
      <p>
        For ECCS: <b>{letter.particulars.signedBy}</b>
      </p>
      {letter.particulars.isSample && <p className="text-xs text-muted">Sample format: ECCS&apos;s company details and terms are samples until a lawyer and the founder settle them.</p>}
    </div>
  );
}

/** The Super Admin's letter panel: make it, open it, record it signed on paper; the handbook's acceptance beside it. */
export function LetterPanel({ data, member, onChange }: { data: OnboardingDto; member: TeamMemberDto; onChange: (next: PersonOnboardingDto) => void }) {
  const notify = useToast();
  const scan = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!data.letter) return null;
  const { current, earlier, missing } = data.letter;
  const who = member.name.split(/\s+/)[0] ?? member.name;
  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  };
  const make = () =>
    act(async () => {
      onChange(await api.onboarding.makeLetter(member.userId));
      notify(current?.status === "ACCEPTED" ? "New letter made: it replaces the old one once accepted" : "Letter made");
    });
  const handbook = data.handbook;
  return (
    <Panel
      title="Appointment letter"
      action={
        missing.length === 0 && (!current || current.status === "ACCEPTED") ? (
          <Button variant="link" className="text-sm" disabled={busy} onClick={() => void make()}>
            {current ? "Make a new letter" : "Make the letter"}
          </Button>
        ) : undefined
      }
    >
      {current ? (
        <div className="flex flex-col gap-1 text-sm">
          <p>
            <b>{current.number}</b>
            <span className="text-muted">
              {" "}
              · version {current.version} · made {when(current.madeAt)}
              {current.madeBy ? ` by ${current.madeBy}` : ""}
            </span>
          </p>
          <p className="font-semibold" style={{ color: current.status === "ACCEPTED" ? GREEN : "#8A5300" }}>
            {letterStatusWords(current, who)}
          </p>
          {current.status === "WAITING" && current.remadeFor.length > 0 && <p className="text-muted">Made again after a change: {current.remadeFor.join(", ").toLowerCase()}.</p>}
        </div>
      ) : (
        <p className="text-sm text-muted">No letter yet.</p>
      )}
      {missing.length > 0 && <p className="text-sm">Before the letter can be made, fill in {missing.join(", ")}.</p>}
      {current && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => void openFile(() => api.onboarding.letterPdf(current.id), `Appointment letter ${current.number.replace(/\//g, "-")}.pdf`, notify)}>
            Open the PDF
          </Button>
          {current.status === "WAITING" && (
            <>
              <Button size="sm" variant="secondary" loading={busy} onClick={() => scan.current?.click()}>
                Signed on paper…
              </Button>
              <input
                ref={scan}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file)
                    void act(async () => {
                      onChange(await api.onboarding.signedOnPaper(current.id, file, file.name));
                      notify("Recorded as signed on paper; the scan is filed");
                    });
                }}
              />
            </>
          )}
        </div>
      )}
      {earlier.length > 0 && (
        <ul className="text-sm text-muted">
          {earlier.map((letter) => (
            <li key={letter.id}>
              Earlier: {letter.number}
              {letter.acceptedAt ? `, accepted ${dayMonth(letter.acceptedAt)}` : ""}
              {letter.replacedAt ? `, replaced ${dayMonth(letter.replacedAt)}` : ""}{" "}
              <Button variant="link" className="text-sm" onClick={() => void openFile(() => api.onboarding.letterPdf(letter.id), `${letter.number.replace(/\//g, "-")}.pdf`, notify)}>
                Open
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-border pt-3 text-sm">
        <b>Staff handbook:</b>{" "}
        {!handbook?.version
          ? "none written yet."
          : handbook.acceptedVersion === handbook.version
            ? `version ${handbook.version} accepted ${handbook.acceptedAt ? when(handbook.acceptedAt) : ""}`
            : handbook.acceptedVersion
              ? `accepted version ${handbook.acceptedVersion}; version ${handbook.version} is newer`
              : `version ${handbook.version}, not accepted yet`}
      </p>
      <ErrorMessage message={error} />
    </Panel>
  );
}

// ───────────────────────── The staff handbook ─────────────────────────

function Inline({ content }: { content: readonly LegalInline[] }) {
  return (
    <>
      {content.map((run, index) =>
        run.type === "bold" ? (
          <b key={index}>{run.text}</b>
        ) : run.type === "link" ? (
          <a key={index} href={run.href} className="text-primary underline" target="_blank" rel="noreferrer">
            {run.text}
          </a>
        ) : (
          <span key={index}>{run.text}</span>
        ),
      )}
    </>
  );
}

/** The handbook's text, in the small part of Markdown the legal documents use (## headings, lists, **bold**). */
export function HandbookText({ body }: { body: string }) {
  return (
    <div className="flex flex-col gap-2.5 text-sm leading-relaxed">
      {parseLegalMarkdown(body).map((block, index) => {
        if (block.type === "ul" || block.type === "ol") {
          const List = block.type;
          return (
            <List key={index} className={`flex flex-col gap-1 pl-5 ${block.type === "ol" ? "list-decimal" : "list-disc"}`}>
              {block.items.map((item, at) => (
                <li key={at}>
                  <Inline content={item} />
                </li>
              ))}
            </List>
          );
        }
        if (block.type === "title" || block.type === "h2") {
          return (
            <h2 key={index} className="mt-2 text-base font-bold">
              <Inline content={block.content} />
            </h2>
          );
        }
        if (block.type === "h3") {
          return (
            <h3 key={index} className="font-semibold">
              <Inline content={block.content} />
            </h3>
          );
        }
        return (
          <p key={index}>
            <Inline content={block.content} />
          </p>
        );
      })}
    </div>
  );
}
