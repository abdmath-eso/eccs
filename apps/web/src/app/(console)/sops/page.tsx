"use client";

import { ApiError } from "@eccs/api-client";
import { can, SOP_CATEGORIES, SOP_LANGUAGES, type SopCategory, type SopDto, type SopLanguage } from "@eccs/shared";
import { useEffect, useState, type FormEvent } from "react";

import { Button, Card, ErrorMessage, Field } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

const CATEGORY: Record<SopCategory, string> = {
  PERSONAL_HYGIENE: "Personal hygiene",
  FOOD_STORAGE: "Food storage",
  CLEANING: "Cleaning",
  EQUIPMENT: "Equipment",
  PEST_CONTROL: "Pest control",
  WASTE: "Waste",
  SAFETY: "Safety",
  OTHER: "Other",
};

const LANGUAGE: Record<SopLanguage, string> = { en: "English", te: "Telugu", hi: "Hindi" };

const describe = (error: unknown) =>
  error instanceof ApiError
    ? error.isNetworkError
      ? "Could not reach the server. Is the API running?"
      : error.message
    : "Something went wrong. Try again.";

const inputStyle =
  "rounded-lg border border-border bg-surface px-3 py-2.5 text-base font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

/** One step per line; blank lines are ignored. */
const toSteps = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/**
 * ECCS's standard SOPs, which every restaurant reads in the app once
 * published. SOPs a restaurant writes for itself are not listed here.
 */
export default function SopsPage() {
  const { user } = useSession();
  const [sops, setSops] = useState<SopDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Supervisors can read; Super Admins and Operations Managers write.
  const mayEdit = user ? user.memberships.some((m) => can([m], "sopTemplates", "create") && !m.organizationId) : false;

  useEffect(() => {
    let cancelled = false;
    api.sops
      .list()
      .then((list) => !cancelled && setSops(list))
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  async function change(action: () => Promise<unknown>): Promise<boolean> {
    setError(null);
    try {
      await action();
      setSops(await api.sops.list());
      return true;
    } catch (e) {
      setError(describe(e));
      return false;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">SOPs</h1>
        <p className="text-muted">
          The standard procedures every restaurant sees in the app. A new SOP is a draft until you publish it. Restaurants can
          also write their own, which only they see.
        </p>
      </div>

      <ErrorMessage message={error} />

      {mayEdit && <AddSopForm onChange={change} />}

      {sops === null && !error && <p className="text-muted">Loading…</p>}
      {sops?.length === 0 && <p className="text-muted">No SOPs yet.</p>}
      {sops?.map((sop) => (
        <SopCard key={sop.id} sop={sop} onChange={change} />
      ))}
    </div>
  );
}

type Change = (action: () => Promise<unknown>) => Promise<boolean>;

function CategorySelect({ value, onChange }: { value: SopCategory; onChange: (value: SopCategory) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      Category
      <select value={value} onChange={(e) => onChange(e.target.value as SopCategory)} className={inputStyle}>
        {SOP_CATEGORIES.map((category) => (
          <option key={category} value={category}>
            {CATEGORY[category]}
          </option>
        ))}
      </select>
    </label>
  );
}

function StepsField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
      Steps
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={7}
        required
        className={inputStyle}
        placeholder={"One step per line, in order"}
      />
      <span className="font-normal text-muted">One step per line. They are numbered automatically.</span>
    </label>
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const saved = await onChange(() => api.sops.create({ category, title, steps: toSteps(steps), language: "en" }));
    setBusy(false);
    if (saved) onClose();
  }

  return (
    <Card>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <h2 className="text-lg font-bold sm:col-span-2">New SOP</h2>
        <Field label="Name (in English)" required minLength={2} maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
        <CategorySelect value={category} onChange={setCategory} />
        <StepsField value={steps} onChange={setSteps} />
        <p className="text-sm text-muted sm:col-span-2">
          It is saved as a draft in English. Add Telugu and Hindi, then publish, from the list below.
        </p>
        <div className="flex gap-3">
          <Button type="submit" loading={busy} disabled={toSteps(steps).length === 0}>
            Save draft
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function SopCard({ sop, onChange }: { sop: SopDto; onChange: Change }) {
  const [viewing, setViewing] = useState<SopLanguage>("en");
  const [editing, setEditing] = useState(false);
  const written = SOP_LANGUAGES.filter((language) => sop.steps[language]);
  const missing = SOP_LANGUAGES.filter((language) => !sop.steps[language]);
  const steps = sop.steps[viewing] ?? [];
  const name = sop.title.en ?? sop.title[written[0] ?? "en"] ?? "Untitled";

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{name}</h2>
          <p className="text-sm text-muted">
            {CATEGORY[sop.category]} · {written.map((language) => LANGUAGE[language]).join(", ")}
            {missing.length > 0 && (
              <span className="text-amber-700"> · missing {missing.map((language) => LANGUAGE[language]).join(" and ")}</span>
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

      <div className="flex flex-wrap gap-1 text-sm font-semibold" role="tablist" aria-label="Language">
        {SOP_LANGUAGES.map((language) => (
          <button
            key={language}
            role="tab"
            aria-selected={viewing === language}
            onClick={() => {
              setViewing(language);
              setEditing(false);
            }}
            className={`cursor-pointer rounded-lg px-3 py-1.5 ${viewing === language ? "bg-primary/10 text-primary" : "text-muted hover:text-foreground"}`}
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
            <div className="flex flex-wrap gap-4">
              <Button variant="link" onClick={() => setEditing(true)}>
                {steps.length > 0 ? `Edit ${LANGUAGE[viewing]}` : `Add ${LANGUAGE[viewing]}`}
              </Button>
              <Button variant="link" onClick={() => void onChange(() => api.sops.update(sop.id, { isPublished: !sop.isPublished }))}>
                {sop.isPublished ? "Unpublish" : "Publish"}
              </Button>
              <Button
                variant="link"
                className="text-danger"
                onClick={() => {
                  if (window.confirm(`Delete "${name}" in every language? This cannot be undone.`)) {
                    void onChange(() => api.sops.remove(sop.id));
                  }
                }}
              >
                Delete
              </Button>
            </div>
          )}
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const saved = await onChange(() => api.sops.update(sop.id, { category, title, steps: toSteps(steps), language }));
    setBusy(false);
    if (saved) onClose();
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <Field
        label={`Name (in ${LANGUAGE[language]})`}
        required
        minLength={2}
        maxLength={100}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <CategorySelect value={category} onChange={setCategory} />
      <StepsField value={steps} onChange={setSteps} />
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
      <div className="flex gap-3">
        <Button type="submit" loading={busy} disabled={toSteps(steps).length === 0}>
          Save
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
