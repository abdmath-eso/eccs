"use client";

import { can, handbookSchema, type StaffHandbookDto } from "@eccs/shared";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { useToast } from "@/components/toast";
import { Button, Card, ErrorMessage, Field, LoadError, Loading, NoAccess, PageHeader, TextAreaField } from "@/components/ui";
import { api } from "@/lib/api";
import { checkAgainst, focusFirstError, hasErrors, type FieldErrors } from "@/lib/forms";
import { describe, when } from "@/lib/format";
import { useSession } from "@/lib/session";

import { SampleBadge } from "../../../finance/finance-parts";
import { HandbookText } from "../../onboarding-parts";

// The staff handbook (16 Oct 2026, the Super Admin): read it as a new person will, and change
// it. A change publishes a new version; the old ones stay, with who accepted which, and anyone
// who accepted an older one is asked to read the new one on their Joining ECCS page.
// PATTERN FOLLOWED: versioned policy documents with an acceptance record per version
// (BambooHR's and Keka's policy acknowledgements; the app's own Terms, 14 Oct 2026).

export default function HandbookScreen() {
  const { user } = useSession();
  if (!user || !can(user.memberships, "team", "approve")) return <NoAccess title="Staff handbook">The staff handbook is kept by the founders.</NoAccess>;
  return <Handbook />;
}

function Handbook() {
  const [data, setData] = useState<StaffHandbookDto | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.onboarding
      .handbook()
      .then((next) => !cancelled && (setData(next), setError(null)))
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const back = (
    <Link href="/team/onboarding" className="w-fit rounded-md text-sm font-semibold text-primary hover:underline">
      ← Onboarding checklist
    </Link>
  );
  if (data === undefined) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        {error ? <LoadError message={error} onRetry={() => setAttempt((value) => value + 1)} /> : <Loading />}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {back}
      <PageHeader
        title={data?.title ?? "Staff handbook"}
        description={data ? `Version ${data.version}, published ${when(data.publishedAt)}${data.publishedBy ? ` by ${data.publishedBy}` : ""}. Every new person reads and accepts it.` : "Not written yet."}
        action={!editing ? <Button onClick={() => setEditing(true)}>{data ? "Change it" : "Write it"}</Button> : undefined}
      />
      {data?.isSample && !editing && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <SampleBadge /> A sample to be replaced by ECCS&apos;s own. Your first change makes it yours.
        </p>
      )}
      {editing ? (
        <HandbookForm
          handbook={data}
          onCancel={() => setEditing(false)}
          onSaved={(next) => {
            setData(next);
            setEditing(false);
          }}
        />
      ) : data ? (
        <Card className="max-w-3xl">
          <HandbookText body={data.body} />
        </Card>
      ) : null}
    </div>
  );
}

function HandbookForm({ handbook, onCancel, onSaved }: { handbook: StaffHandbookDto | null; onCancel: () => void; onSaved: (next: StaffHandbookDto) => void }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const input = { title: String(values.get("title") ?? "").trim(), body: String(values.get("body") ?? "").trim() };
    const found = checkAgainst(handbookSchema, input);
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);
    setBusy(true);
    setError(null);
    try {
      const next = await api.onboarding.publishHandbook(input);
      notify(`Version ${next.version} published. New people accept this one; earlier acceptances are kept.`);
      onSaved(next);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(event) => void save(event)} noValidate className="flex max-w-3xl flex-col gap-4">
      <Field label="Title" name="title" required maxLength={80} defaultValue={handbook?.title.replace(/ \(sample\)$/, "") ?? "ECCS staff handbook"} error={errors.title} />
      <TextAreaField
        label="The handbook"
        name="body"
        required
        rows={22}
        defaultValue={handbook?.body ?? ""}
        hint="## starts a heading, - starts a point in a list, **words** are bold"
        error={errors.body}
        className="font-mono text-sm"
      />
      <ErrorMessage message={error} />
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>
          Publish as version {(handbook?.version ?? 0) + 1}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
