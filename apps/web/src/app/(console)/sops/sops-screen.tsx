"use client";

import { can, SOP_CATEGORIES, SOP_LANGUAGES, type SopCategory, type SopDto, type SopLanguage } from "@eccs/shared";
import { useEffect, useState, type FormEvent } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { Button, Card, ErrorMessage, Field, LoadError, Loading, PageHeader, SelectField, TextAreaField } from "@/components/ui";
import { api } from "@/lib/api";
import { focusFirstError, hasErrors, type FieldErrors } from "@/lib/forms";
import { describe, matchesSearch } from "@/lib/format";
import { useQueryField } from "@/lib/query";
import { useSession } from "@/lib/session";

const CATEGORY: Record<SopCategory, string> = {
  PERSONAL_HYGIENE: "Food safety and hygiene",
  FOOD_PREP: "Food preparation and cooking",
  FOOD_STORAGE: "Storage, stock and receiving",
  CLEANING: "Cleaning and dishwashing",
  EQUIPMENT: "Equipment and utilities",
  PEST_CONTROL: "Pest control",
  WASTE: "Waste",
  SAFETY: "Safety and security",
  SERVICE: "Service, billing and delivery",
  STAFF: "Staff and training",
  MANAGEMENT: "Management and records",
  RECIPES: "Recipes and dishes",
  OTHER: "Other",
};

const LANGUAGE: Record<SopLanguage, string> = {
  en: "English",
  hi: "Hindi",
  te: "Telugu",
  ta: "Tamil",
  kn: "Kannada",
  ml: "Malayalam",
  mr: "Marathi",
  bn: "Bengali",
  gu: "Gujarati",
  pa: "Punjabi",
  or: "Odia",
  ur: "Urdu",
};

/** One step per line; blank lines are ignored. */
const toSteps = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** Checks the name and steps of an SOP before it is sent, by the fields' names. */
function checkSop(title: string, steps: string): FieldErrors {
  const found: FieldErrors = {};
  if (title.trim().length < 2) found.title = "Give the SOP a name.";
  if (toSteps(steps).length === 0) found.steps = "Add at least one step.";
  return found;
}

/**
 * Does something to an SOP, then reloads the list and confirms it briefly.
 * Returns `null` if it worked, or what went wrong, for the card or form that
 * asked to show beside itself.
 */
type Change = (action: () => Promise<unknown>, done: string) => Promise<string | null>;

/**
 * ECCS's standard SOPs, which every restaurant reads in the app once
 * published. SOPs a restaurant writes for itself are not listed here.
 *
 * The search is kept in the web address as `q=`.
 */
export default function SopsScreen() {
  const { user } = useSession();
  const notify = useToast();
  const [search, setSearch] = useQueryField("q");
  const [sops, setSops] = useState<SopDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Supervisors can read; Super Admins and Operations Managers write.
  const mayEdit = user ? user.memberships.some((m) => can([m], "sopTemplates", "create") && !m.organizationId) : false;

  useEffect(() => {
    let cancelled = false;
    api.sops
      .list()
      .then((list) => {
        if (cancelled) return;
        setSops(list);
        setError(null);
      })
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const change: Change = async (action, done) => {
    try {
      await action();
      setSops(await api.sops.list());
      notify(done);
      return null;
    } catch (e) {
      return describe(e);
    }
  };

  const matching = (sops ?? []).filter((sop) => matchesSearch(search, [...Object.values(sop.title), CATEGORY[sop.category]]));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="SOPs"
        description="The standard procedures every restaurant sees in the app."
        how={
          <>
            <p>A new SOP is a draft until you publish it.</p>
            <p>Restaurants can also write their own, which only they see.</p>
          </>
        }
      />

      {mayEdit && <AddSopForm onChange={change} />}

      <LoadError message={error} onRetry={() => setAttempt((current) => current + 1)} />
      {sops === null && !error && <Loading />}
      {sops?.length === 0 && <p className="text-muted">No SOPs yet.</p>}

      {sops && sops.length > 0 && (
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <Field
            label="Search SOPs"
            type="search"
            plainLabel
            hint="By name or category."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            wrapperClassName="w-full max-w-md"
          />
          <p role="status" className="text-sm text-muted">
            {search
              ? matching.length === 0
                ? `No SOPs match "${search}".`
                : `Showing ${matching.length} of ${sops.length} SOPs.`
              : `${sops.length} SOP${sops.length === 1 ? "" : "s"}.`}
          </p>
        </div>
      )}

      {matching.map((sop) => (
        <SopCard key={sop.id} sop={sop} onChange={change} />
      ))}
    </div>
  );
}

function CategorySelect({ value, onChange }: { value: SopCategory; onChange: (value: SopCategory) => void }) {
  return (
    <SelectField label="Category" name="category" value={value} onChange={(e) => onChange(e.target.value as SopCategory)}>
      {SOP_CATEGORIES.map((category) => (
        <option key={category} value={category}>
          {CATEGORY[category]}
        </option>
      ))}
    </SelectField>
  );
}

function StepsField({ value, error, onChange }: { value: string; error?: string; onChange: (value: string) => void }) {
  return (
    <TextAreaField
      label="Steps"
      name="steps"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={7}
      required
      hint="One step per line, in order. They are numbered automatically."
      error={error}
      wrapperClassName="sm:col-span-2"
    />
  );
}

function AddSopForm({ onChange }: { onChange: Change }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div>
        <Button onClick={() => setOpen(true)}>+ New SOP</Button>
      </div>
    );
  }
  return <AddSopFields onChange={onChange} onClose={() => setOpen(false)} />;
}

function AddSopFields({ onChange, onClose }: { onChange: Change; onClose: () => void }) {
  const [category, setCategory] = useState<SopCategory>("CLEANING");
  const [title, setTitle] = useState("");
  const [steps, setSteps] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = checkSop(title, steps);
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(event.currentTarget, found);

    setBusy(true);
    setError(null);
    const failure = await onChange(() => api.sops.create({ category, title, steps: toSteps(steps), language: "en" }), "Draft saved");
    setBusy(false);
    if (failure) setError(failure);
    else onClose();
  }

  return (
    <Card>
      <form onSubmit={submit} noValidate className="grid items-start gap-3 sm:grid-cols-2">
        <h2 className="text-lg font-bold sm:col-span-2">New SOP</h2>
        <Field label="Name (in English)" name="title" required maxLength={100} value={title} error={errors.title} onChange={(e) => setTitle(e.target.value)} />
        <CategorySelect value={category} onChange={setCategory} />
        <StepsField value={steps} error={errors.steps} onChange={setSteps} />
        <p className="text-sm text-muted sm:col-span-2">
          It is saved as a draft in English. Add Telugu and Hindi, then publish, from the list below.
        </p>
        <div className="flex flex-col gap-3 sm:col-span-2">
          <ErrorMessage message={error} />
          <div className="flex gap-3">
            <Button type="submit" loading={busy}>
              Save draft
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

function SopCard({ sop, onChange }: { sop: SopDto; onChange: Change }) {
  const confirm = useConfirm();
  const [viewing, setViewing] = useState<SopLanguage>("en");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const written = SOP_LANGUAGES.filter((language) => sop.steps[language]);
  const missing = SOP_LANGUAGES.filter((language) => !sop.steps[language]);
  const steps = sop.steps[viewing] ?? [];
  const name = sop.title.en ?? sop.title[written[0] ?? "en"] ?? "Untitled";

  async function act(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setError(await onChange(action, done));
    setBusy(false);
  }

  async function remove() {
    const sure = await confirm({
      title: `Delete "${name}"?`,
      body: "It is deleted in every language. This cannot be undone.",
      confirmLabel: "Delete the SOP",
      cancelLabel: "Keep the SOP",
    });
    if (sure) void act(() => api.sops.remove(sop.id), "SOP deleted");
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{name}</h2>
          <p className="text-sm text-muted">
            {CATEGORY[sop.category]} · {written.map((language) => LANGUAGE[language]).join(", ")}
            {missing.length > 0 && (
              <span className="text-amber-700"> · missing {missing.map((language) => LANGUAGE[language]).join(", ")}</span>
            )}
          </p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
            sop.isPublished ? "border-primary text-primary" : "border-amber-600 text-amber-700"
          }`}
        >
          {sop.isPublished ? "Published" : "Draft, not visible to restaurants"}
        </span>
      </div>

      {/* Plain buttons that say which one is on. The one that is on has an outline as well as a colour. */}
      <div className="flex flex-wrap gap-1 text-sm font-semibold" role="group" aria-label={`Language of ${name}`}>
        {SOP_LANGUAGES.map((language) => (
          <button
            key={language}
            type="button"
            aria-pressed={viewing === language}
            onClick={() => {
              setViewing(language);
              setEditing(false);
            }}
            className={`cursor-pointer rounded-lg border px-3 py-1.5 ${
              viewing === language ? "border-primary bg-primary/10 text-primary" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {LANGUAGE[language]}
          </button>
        ))}
      </div>

      {editing ? (
        <EditSopForm key={viewing} sop={sop} language={viewing} onChange={onChange} onClose={() => setEditing(false)} />
      ) : (
        <>
          {steps.length > 0 ? (
            <>
              <p className="font-semibold">{sop.title[viewing]}</p>
              <ol className="list-decimal space-y-1 pl-6">
                {steps.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>
            </>
          ) : (
            <p className="text-muted">Not written in {LANGUAGE[viewing]} yet. Restaurants using {LANGUAGE[viewing]} see the English.</p>
          )}

          {sop.canEdit && (
            <div className="-ml-2 flex flex-wrap gap-2">
              <Button variant="link" disabled={busy} onClick={() => setEditing(true)}>
                {steps.length > 0 ? `Edit ${LANGUAGE[viewing]}` : `Add ${LANGUAGE[viewing]}`}
              </Button>
              <Button
                variant="link"
                disabled={busy}
                onClick={() =>
                  void act(() => api.sops.update(sop.id, { isPublished: !sop.isPublished }), sop.isPublished ? "SOP unpublished" : "SOP published")
                }
              >
                {sop.isPublished ? "Unpublish" : "Publish"}
              </Button>
              <Button variant="link" className="text-danger" disabled={busy} onClick={() => void remove()}>
                Delete
              </Button>
            </div>
          )}
          <ErrorMessage message={error} />
        </>
      )}
    </Card>
  );
}

function EditSopForm({ sop, language, onChange, onClose }: { sop: SopDto; language: SopLanguage; onChange: Change; onClose: () => void }) {
  const [category, setCategory] = useState<SopCategory>(sop.category);
  const [title, setTitle] = useState(sop.title[language] ?? "");
  const [steps, setSteps] = useState((sop.steps[language] ?? []).join("\n"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = checkSop(title, steps);
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(event.currentTarget, found);

    setBusy(true);
    setError(null);
    const failure = await onChange(() => api.sops.update(sop.id, { category, title, steps: toSteps(steps), language }), `${LANGUAGE[language]} saved`);
    setBusy(false);
    if (failure) setError(failure);
    else onClose();
  }

  return (
    <form onSubmit={submit} noValidate className="grid items-start gap-3 sm:grid-cols-2">
      <Field
        label={`Name (in ${LANGUAGE[language]})`}
        name="title"
        required
        maxLength={100}
        value={title}
        error={errors.title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <CategorySelect value={category} onChange={setCategory} />
      <StepsField value={steps} error={errors.steps} onChange={setSteps} />
      {language !== "en" && sop.steps.en && (
        <div className="rounded-lg bg-background p-3 text-sm text-muted sm:col-span-2">
          <p className="font-semibold">English, for reference: {sop.title.en}</p>
          <ol className="list-decimal pl-5">
            {sop.steps.en.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        </div>
      )}
      <div className="flex flex-col gap-3 sm:col-span-2">
        <ErrorMessage message={error} />
        <div className="flex gap-3">
          <Button type="submit" loading={busy}>
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
