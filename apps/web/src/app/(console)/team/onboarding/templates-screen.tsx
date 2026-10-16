"use client";

import {
  AUTO_LABELS,
  can,
  DOCUMENT_LABELS,
  JOINING_DOCUMENT_KINDS,
  letterSettingsSchema,
  ONBOARDING_AUTO,
  ONBOARDING_OWNERS,
  ONBOARDING_PHASES,
  OWNER_LABELS,
  PHASE_DAYS,
  PHASE_LABELS,
  TEAM_ROLES,
  TEMPLATE_ROLE_LABELS,
  templateTaskSchema,
  whenWords,
  type DocumentAsked,
  type LetterSettings,
  type OnboardingAuto,
  type OnboardingOwner,
  type OnboardingPhase,
  type OnboardingTemplateDto,
  type OnboardingTemplatesDto,
  type TeamRole,
  type TemplateTaskDto,
} from "@eccs/shared";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { Button, ErrorMessage, Field, LoadError, Loading, NoAccess, PageHeader, SelectField, TextAreaField } from "@/components/ui";
import { api } from "@/lib/api";
import { checkAgainst, focusFirstError, hasErrors, type FieldErrors } from "@/lib/forms";
import { describe } from "@/lib/format";
import { useQuery } from "@/lib/query";
import { useSession } from "@/lib/session";

import { Panel, SampleBadge, Segmented, Sheet } from "../../finance/finance-parts";

// The onboarding checklist templates (16 Oct 2026, the Super Admin): one per role, each task
// with its phase, who does it, its day counted from the joining day, whether it is required
// and whether it ticks itself; the documents each role is asked for; and links to the staff
// handbook and the appointment letter's terms. Copied to a person when their onboarding
// starts, so a change here reaches only people started afterwards.
//
// PATTERN FOLLOWED: BambooHR's onboarding task list settings (tasks by category, each with an
// assignee and a due date from the hire date, edited in place) and Keka's onboarding template
// (tasks per stage, documents chosen per template, a template per role). Reordering by up and
// down buttons, which work with a keyboard and a screen reader, rather than dragging only.

export default function TemplatesScreen() {
  const { user } = useSession();
  if (!user || !can(user.memberships, "team", "approve")) return <NoAccess title="Onboarding checklist">The onboarding checklists are the founders&apos;.</NoAccess>;
  return <Templates />;
}

type Editing = { role: TeamRole; task: TemplateTaskDto | null } | null;

function Templates() {
  const notify = useToast();
  const confirm = useConfirm();
  const query = useQuery();
  const [data, setData] = useState<OnboardingTemplatesDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState<Editing>(null);
  const [terms, setTerms] = useState(false);
  const asked = query.get("role");
  const role = ((TEAM_ROLES as readonly string[]).includes(asked) ? asked : "SUPERVISOR") as TeamRole;

  useEffect(() => {
    let cancelled = false;
    api.onboarding
      .templates()
      .then((next) => !cancelled && (setData(next), setError(null)))
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const back = (
    <Link href="/team" className="w-fit rounded-md text-sm font-semibold text-primary hover:underline">
      ← Team
    </Link>
  );
  const header = (
    <PageHeader
      title="Onboarding checklist"
      description="A new person's first three months, by role. Copied to them when their onboarding starts: a change here reaches people started afterwards."
      action={<Button onClick={() => setEditing({ role, task: null })}>Add a task</Button>}
      secondary={
        <>
          <Link href="/team/onboarding/handbook" className="rounded-lg border border-border-strong bg-surface px-4 py-2.5 font-semibold hover:bg-background">
            Staff handbook
          </Link>
          <Button variant="secondary" onClick={() => setTerms(true)}>
            Letter terms
          </Button>
        </>
      }
    />
  );
  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        {header}
        {error ? <LoadError message={error} onRetry={() => setAttempt((value) => value + 1)} /> : <Loading />}
      </div>
    );
  }
  const template = data.templates.find((entry) => entry.role === role)!;

  const run = async (work: () => Promise<OnboardingTemplatesDto>, done: string) => {
    try {
      setData(await work());
      notify(done);
    } catch (e) {
      notify(describe(e));
    }
  };
  const remove = async (task: TemplateTaskDto) => {
    const sure = await confirm({ title: `Remove "${task.title}"?`, body: "People whose onboarding has started keep it on their checklist.", confirmLabel: "Remove the task", cancelLabel: "Keep it" });
    if (sure) await run(() => api.onboarding.removeTemplateTask(task.id), "Task removed");
  };

  return (
    <div className="flex flex-col gap-4">
      {back}
      {header}
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Role"
          showLabel={false}
          value={role}
          onChange={(value) => query.set({ role: value }, "replace")}
          options={data.templates.map((entry) => ({ value: entry.role, label: `${entry.label} (${entry.tasks.length})` }))}
        />
        {template.isSample && (
          <span className="flex items-center gap-2 text-sm text-muted">
            <SampleBadge /> Change anything and it becomes yours.
          </span>
        )}
      </div>

      {ONBOARDING_PHASES.map((phase) => {
        const tasks = template.tasks.filter((task) => task.phase === phase).sort((a, b) => a.position - b.position);
        return (
          <Panel key={phase} title={PHASE_LABELS[phase]} description={phaseWords(phase)}>
            {tasks.length === 0 ? (
              <p className="text-sm text-muted">No tasks.</p>
            ) : (
              <ol className="flex flex-col divide-y divide-border">
                {tasks.map((task, index) => (
                  <li key={task.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{task.title}</p>
                      <p className="text-xs text-muted">
                        {[OWNER_LABELS[task.owner], whenWords(task.daysFromJoining), task.auto ? `ticks itself when ${AUTO_LABELS[task.auto]}` : null, task.required ? null : "optional"]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <Button variant="link" className="text-sm" disabled={index === 0} aria-label={`Move up: ${task.title}`} onClick={() => void run(() => api.onboarding.moveTemplateTask(task.id, "up"), "Moved")}>
                        ↑
                      </Button>
                      <Button
                        variant="link"
                        className="text-sm"
                        disabled={index === tasks.length - 1}
                        aria-label={`Move down: ${task.title}`}
                        onClick={() => void run(() => api.onboarding.moveTemplateTask(task.id, "down"), "Moved")}
                      >
                        ↓
                      </Button>
                      <Button variant="link" className="text-sm" onClick={() => setEditing({ role, task })}>
                        Change<span className="sr-only"> {task.title}</span>
                      </Button>
                      <Button variant="link" className="text-sm text-danger" onClick={() => void remove(task)}>
                        Remove<span className="sr-only"> {task.title}</span>
                      </Button>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        );
      })}

      <DocumentsAsked key={`${role}-${template.updatedAt}`} template={template} onSaved={setData} />

      <Sheet open={editing !== null} title={editing?.task ? "Change the task" : `A task for every new ${TEMPLATE_ROLE_LABELS[role]}`} onClose={() => setEditing(null)}>
        {editing && <TaskForm key={editing.task?.id ?? "new"} role={editing.role} task={editing.task} onClose={() => setEditing(null)} onSaved={setData} />}
      </Sheet>
      <Sheet open={terms} title="The appointment letter's terms" onClose={() => setTerms(false)} wide>
        {terms && <TermsForm settings={data.settings} onClose={() => setTerms(false)} onSaved={(settings) => setData({ ...data, settings })} />}
      </Sheet>
    </div>
  );
}

/** "Up to the joining day", "Days 1 to 6 after joining". */
function phaseWords(phase: OnboardingPhase) {
  const { from, to } = PHASE_DAYS[phase];
  if (phase === "BEFORE_JOINING") return "Up to the joining day";
  if (from === to) return "The joining day";
  return `Days ${from} to ${to} after joining`;
}

function TaskForm({ role, task, onClose, onSaved }: { role: TeamRole; task: TemplateTaskDto | null; onClose: () => void; onSaved: (data: OnboardingTemplatesDto) => void }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [phase, setPhase] = useState<OnboardingPhase>(task?.phase ?? "FIRST_WEEK");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const text = (name: string) => String(values.get(name) ?? "").trim();
    const auto = text("auto");
    const input = {
      title: text("title"),
      phase,
      owner: text("owner") as OnboardingOwner,
      daysFromJoining: text("daysFromJoining") === "" ? Number.NaN : Number(text("daysFromJoining")),
      required: values.get("required") === "on",
      auto: auto ? (auto as OnboardingAuto) : null,
    };
    const found = checkAgainst(templateTaskSchema, input);
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);
    setBusy(true);
    setError(null);
    try {
      onSaved(task ? await api.onboarding.changeTemplateTask(task.id, input) : await api.onboarding.addTemplateTask(role, input));
      notify(task ? "Task changed" : "Task added");
      onClose();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }
  const range = PHASE_DAYS[phase];
  return (
    <form onSubmit={(event) => void save(event)} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-muted">People whose onboarding has started already keep their checklist as it was.</p>
      <Field label="Task" name="title" required maxLength={120} defaultValue={task?.title ?? ""} error={errors.title} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Phase"
          name="phase"
          value={phase}
          onChange={(event) => setPhase(event.target.value as OnboardingPhase)}
          error={errors.phase}
        >
          {ONBOARDING_PHASES.map((value) => (
            <option key={value} value={value}>
              {PHASE_LABELS[value]}
            </option>
          ))}
        </SelectField>
        <Field
          key={phase}
          label="Due: days from joining"
          name="daysFromJoining"
          type="number"
          required
          min={range.from}
          max={range.to}
          defaultValue={String(task && task.phase === phase ? task.daysFromJoining : range.from === range.to ? range.from : phase === "BEFORE_JOINING" ? -1 : range.from)}
          hint={phase === "BEFORE_JOINING" ? "0 is the joining day; -2 is two days before" : range.from === range.to ? "0: the joining day" : `${range.from} to ${range.to}`}
          error={errors.daysFromJoining}
        />
      </div>
      <SelectField label="Who does it" name="owner" defaultValue={task?.owner ?? "OPS_MANAGER"} error={errors.owner}>
        {ONBOARDING_OWNERS.map((owner) => (
          <option key={owner} value={owner}>
            {OWNER_LABELS[owner]}
          </option>
        ))}
      </SelectField>
      <SelectField label="Ticks itself" name="auto" defaultValue={task?.auto ?? ""} hint="When the app can see it done" error={errors.auto}>
        <option value="">No: ticked by hand</option>
        {ONBOARDING_AUTO.map((auto) => (
          <option key={auto} value={auto}>
            When {AUTO_LABELS[auto]}
          </option>
        ))}
      </SelectField>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="required" defaultChecked={task?.required ?? true} className="h-4 w-4 accent-primary" />
        Must be done before onboarding is done
      </label>
      <ErrorMessage message={error} />
      <div className="flex gap-2 border-t border-border pt-4">
        <Button type="submit" loading={busy}>
          {task ? "Save" : "Add the task"}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Which documents the role is asked for, and which are required. */
function DocumentsAsked({ template, onSaved }: { template: OnboardingTemplateDto; onSaved: (data: OnboardingTemplatesDto) => void }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = new Map(template.documents.map((entry) => [entry.kind, entry.required ? "required" : "optional"]));
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const documents: DocumentAsked[] = JOINING_DOCUMENT_KINDS.flatMap((kind) => {
      const choice = String(values.get(kind) ?? "");
      return choice === "required" || choice === "optional" ? [{ kind, required: choice === "required" }] : [];
    });
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.onboarding.setTemplateDocuments(template.role, documents));
      notify("Documents saved");
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title="Documents asked for" description="The new person uploads these on their Joining ECCS page; you accept each or send it back.">
      <form onSubmit={(event) => void save(event)} className="flex flex-col gap-3">
        <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {JOINING_DOCUMENT_KINDS.map((kind) => (
            <li key={kind} className="flex items-center justify-between gap-3">
              <span className="text-sm">
                <span className="font-medium">{DOCUMENT_LABELS[kind].label}</span>
              </span>
              <select name={kind} defaultValue={current.get(kind) ?? "no"} aria-label={DOCUMENT_LABELS[kind].label} className="rounded-lg border border-border-strong bg-surface px-2 py-1.5 text-sm">
                <option value="no">Not asked</option>
                <option value="optional">Optional</option>
                <option value="required">Required</option>
              </select>
            </li>
          ))}
        </ul>
        <ErrorMessage message={error} />
        <div>
          <Button type="submit" size="sm" variant="secondary" loading={busy}>
            Save the documents
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/** The letter's terms (the defaults are Claude's, for a lawyer or CA to check). */
function TermsForm({ settings, onClose, onSaved }: { settings: LetterSettings; onClose: () => void; onSaved: (settings: LetterSettings) => void }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const text = (name: string) => String(values.get(name) ?? "").trim();
    const number = (name: string) => (text(name) === "" ? Number.NaN : Number(text(name)));
    const byRole = (prefix: string) => Object.fromEntries(TEAM_ROLES.map((role) => [role, text(`${prefix}.${role}`)])) as Record<TeamRole, string>;
    const input = {
      hoursPerDay: number("hoursPerDay"),
      hoursPerWeek: number("hoursPerWeek"),
      probationMonths: number("probationMonths"),
      noticeDays: number("noticeDays"),
      probationNoticeDays: number("probationNoticeDays"),
      city: text("city"),
      wagesNote: text("wagesNote"),
      leave: text("leave"),
      socialSecurity: text("socialSecurity"),
      skill: byRole("skill"),
      duties: byRole("duties"),
    };
    const found = checkAgainst(letterSettingsSchema, input);
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.onboarding.saveLetterSettings(input));
      notify("Letter terms saved. Letters waiting to be accepted are made again; accepted ones stay as they are.");
      onClose();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(event) => void save(event)} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-muted">What every appointment letter says. A lawyer or CA should check these before real use.</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Field label="Hours a day" name="hoursPerDay" type="number" required defaultValue={String(settings.hoursPerDay)} error={errors.hoursPerDay} />
        <Field label="Hours a week" name="hoursPerWeek" type="number" required defaultValue={String(settings.hoursPerWeek)} error={errors.hoursPerWeek} />
        <Field label="Probation, months" name="probationMonths" type="number" required defaultValue={String(settings.probationMonths)} error={errors.probationMonths} />
        <Field label="Notice, days" name="noticeDays" type="number" required defaultValue={String(settings.noticeDays)} error={errors.noticeDays} />
        <Field label="Notice in probation, days" name="probationNoticeDays" type="number" required defaultValue={String(settings.probationNoticeDays)} error={errors.probationNoticeDays} />
        <Field label="City" name="city" required defaultValue={settings.city} error={errors.city} />
      </div>
      <TextAreaField label="Wages: how they are made up and paid" name="wagesNote" required rows={2} defaultValue={settings.wagesNote} error={errors.wagesNote} />
      <TextAreaField label="Leave" name="leave" required rows={2} defaultValue={settings.leave} error={errors.leave} />
      <TextAreaField label="Social security (EPF and ESI)" name="socialSecurity" required rows={2} defaultValue={settings.socialSecurity} error={errors.socialSecurity} />
      {TEAM_ROLES.map((role) => (
        <fieldset key={role} className="flex flex-col gap-3 border-t border-border pt-4">
          <legend className="font-bold">{TEMPLATE_ROLE_LABELS[role]}</legend>
          <Field label="Category of skill" name={`skill.${role}`} required defaultValue={settings.skill[role]} error={errors.skill} />
          <TextAreaField label="Nature of duties" name={`duties.${role}`} required rows={3} defaultValue={settings.duties[role]} error={errors.duties} />
        </fieldset>
      ))}
      <ErrorMessage message={error} />
      <div className="sticky bottom-0 flex gap-2 border-t border-border bg-surface py-3">
        <Button type="submit" loading={busy}>
          Save the terms
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
