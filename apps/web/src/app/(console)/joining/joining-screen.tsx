"use client";

import { ApiError } from "@eccs/api-client";
import { type JoiningDocumentDto, type JoiningPageDto, type JoiningTodoDto, type OnboardingTaskDto } from "@eccs/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { useToast } from "@/components/toast";
import { Button, Card, ErrorMessage, LoadError, Loading, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { describe, when } from "@/lib/format";
import { useNavCounts } from "@/lib/nav-counts";

import { Panel } from "../finance/finance-parts";
import { DocumentList, HandbookText, JoiningForm, LetterText, openFile, ProgressLine, TaskRow } from "../team/onboarding-parts";

// "Joining ECCS" (16 Oct 2026): a new team member's own page, opened from the link ECCS sends
// them on WhatsApp, in their phone's browser, with the number and one-time code ECCS staff log
// in with. First what is left for them (their details, their documents, their letter, the
// handbook), then their first week; a short notice of what ECCS keeps, folded away. Only ever
// their own: the server finds it from the login, never from anything in the address.
//
// PATTERN FOLLOWED: the new-hire portals of Zoho People (the candidate portal before joining),
// Keka (preboarding: tasks, documents, the offer letter to accept) and BambooHR (the new hire
// packet: one list of what to do, each step its own page); short, one-column steps for a phone
// (GOV.UK's "one thing per page" and its task list pattern, which says each task's status in
// words). The notice follows the DPDP Rules' itemised notice: what is kept, why, who sees it,
// whom to ask.

/** The person's own joining page, with a way to load it again after a change. */
function useJoining() {
  const [page, setPage] = useState<JoiningPageDto | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { refresh } = useNavCounts();
  useEffect(() => {
    let cancelled = false;
    api.onboarding
      .mine()
      .then(({ page: next }) => !cancelled && (setPage(next), setError(null)))
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  const update = useCallback(
    (next: JoiningPageDto | null) => {
      setPage(next);
      refresh();
    },
    [refresh],
  );
  return { page, error, retry: () => setAttempt((value) => value + 1), update };
}

function Frame({ back = false, children }: { back?: boolean; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      {back && (
        <Link href="/joining" className="w-fit rounded-md text-sm font-semibold text-primary hover:underline">
          ← Joining ECCS
        </Link>
      )}
      {children}
    </div>
  );
}

/** While loading, after a failure, or for someone with no joining page. */
function NotYet({ page, error, retry, back }: { page: JoiningPageDto | null | undefined; error: string | null; retry: () => void; back?: boolean }) {
  return (
    <Frame back={back}>
      {error ? (
        <LoadError message={error} onRetry={retry} />
      ) : page === undefined ? (
        <Loading />
      ) : (
        <>
          <PageHeader title="Joining ECCS" />
          <Card>
            <p className="font-semibold">There is nothing for you to fill in here.</p>
            <p className="mt-1 text-muted">This page is for a new member of ECCS&apos;s team whose joining has started. Ask a founder if you expected to see it.</p>
          </Card>
        </>
      )}
    </Frame>
  );
}

const TODO_LINKS: Record<JoiningTodoDto["key"], string> = { DETAILS: "/joining/details", DOCUMENTS: "#documents", LETTER: "/joining/letter", HANDBOOK: "/joining/handbook" };

// ───────────────────────── The page ─────────────────────────

export function JoiningHome() {
  const { page, error, retry, update } = useJoining();
  const notify = useToast();
  if (!page) return <NotYet page={page} error={error} retry={retry} />;
  const first = page.name.split(/\s+/)[0] ?? page.name;
  const done = page.todo.filter((entry) => entry.done).length;

  const onTick = async (task: OnboardingTaskDto, value: boolean) => {
    try {
      update((await api.onboarding.tickMine(task.id, { done: value })).page);
    } catch (e) {
      notify(describe(e));
    }
  };
  const ownTasks = page.myTasks.filter((task) => !page.firstWeek.some((entry) => entry.id === task.id));

  return (
    <Frame>
      <PageHeader
        title="Joining ECCS"
        description={`Welcome, ${first}. ${page.joiningWords} as ${page.roleLabel === "Ops Manager" ? "the" : "a"} ${page.roleLabel}${page.area ? `, ${page.area}` : ""}.`}
      />

      {/* ── What is left for them, first ── */}
      <section aria-labelledby="todo" className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:p-5">
        <h2 id="todo" className="font-bold">
          {page.left === 0 ? "All four done. Thank you." : "Before you join"}
        </h2>
        <ProgressLine done={done} total={page.todo.length} />
        <ol className="flex flex-col divide-y divide-border">
          {page.todo.map((entry, index) => (
            <li key={entry.key}>
              <Link href={TODO_LINKS[entry.key]} className="flex min-h-14 items-center gap-3 py-2.5">
                <span
                  aria-hidden
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold"
                  style={entry.done ? { background: "#2E7D32", borderColor: "#2E7D32", color: "#fff" } : { borderColor: "#9AA1AB" }}
                >
                  {entry.done ? "✓" : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-primary">{entry.title}</span>
                  <span className="block text-sm text-muted">
                    <span className="sr-only">{entry.done ? "Done. " : "To do. "}</span>
                    {entry.words}
                  </span>
                </span>
                <span aria-hidden className="text-muted">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Documents, uploaded from here ── */}
      <div id="documents" className="scroll-mt-20">
        <Panel title="Your documents" description="A photo or a PDF of each, up to 10 MB. Take the photo in good light, the whole page in view.">
          <DocumentList
            documents={page.documents}
            admin={false}
            onUpload={async (document: JoiningDocumentDto, file: File) => {
              update((await api.onboarding.uploadMine(document.kind, file, file.name)).page);
              notify(`${document.label} uploaded. ECCS will check it.`);
            }}
            onOpen={(document) => void openFile(() => api.onboarding.documentFile(document.documentId!), document.label, notify)}
          />
        </Panel>
      </div>

      {/* ── Their first week ── */}
      {page.firstWeek.length > 0 && (
        <Panel title="Your first week" description="Who you meet and what you do, day by day.">
          <ul className="flex flex-col divide-y divide-border">
            {page.firstWeek.map((task) => (
              <TaskRow key={task.id} task={task} you onTick={onTick} />
            ))}
          </ul>
        </Panel>
      )}
      {ownTasks.length > 0 && (
        <Panel title="Also for you">
          <ul className="flex flex-col divide-y divide-border">
            {ownTasks.map((task) => (
              <TaskRow key={task.id} task={task} you onTick={onTick} />
            ))}
          </ul>
        </Panel>
      )}

      <Notice />
    </Frame>
  );
}

/** What ECCS keeps about them, why, who sees it, and whom to ask: short, folded away. */
function Notice() {
  return (
    <details className="rounded-xl border border-border bg-surface px-4 py-3 text-sm sm:px-5">
      <summary className="cursor-pointer font-semibold text-primary">What ECCS keeps about you</summary>
      <div className="mt-2 flex flex-col gap-2 text-muted">
        <p>
          <b className="text-foreground">What:</b> the details on this page, the documents you upload, your appointment letter and the handbook you accept. Of your ID, only
          its type and last 4 digits; never a whole Aadhaar number.
        </p>
        <p>
          <b className="text-foreground">Why:</b> to employ you and pay your salary, to keep the records the law asks of an employer, and for the security of the clients
          whose kitchens you work in.
        </p>
        <p>
          <b className="text-foreground">Who sees it:</b> the founders. The Ops Manager sees only which steps are done. A document sent back to you is deleted at once.
        </p>
        <p>
          <b className="text-foreground">To see or correct it:</b> change your details here, or ask a founder.
        </p>
      </div>
    </details>
  );
}

// ───────────────────────── Your details ─────────────────────────

export function JoiningDetailsPage() {
  const { page, error, retry, update } = useJoining();
  const router = useRouter();
  const notify = useToast();
  if (!page) return <NotYet page={page} error={error} retry={retry} back />;
  const shown = page.file.shown;
  return (
    <Frame back>
      <PageHeader title="Your details" description="For your letter, your salary and your safety on site. Save any time; come back to finish." />
      {page.file.missing.length > 0 && page.file.updatedAt && (
        <p className="text-sm">
          <b style={{ color: "#8A5300" }}>Still to fill in:</b> {page.file.missing.join(", ")}
        </p>
      )}
      <Card>
        <JoiningForm
          values={{ ...shown, bankAccount: null, pan: null }}
          masks={{ bankAccount: shown.bankAccount, pan: shown.pan }}
          saveLabel="Save my details"
          onSave={async (input) => {
            const next = (await api.onboarding.saveMyDetails(input)).page;
            update(next);
            notify(next?.file.complete ? "Details saved. Thank you." : `Saved. Still to fill in: ${next?.file.missing.length ?? 0}.`);
            router.push("/joining");
          }}
        />
      </Card>
    </Frame>
  );
}

// ───────────────────────── Your letter ─────────────────────────

export function JoiningLetterPage() {
  const { page, error, retry, update } = useJoining();
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!page) return <NotYet page={page} error={error} retry={retry} back />;
  const letter = page.letter;

  async function accept() {
    if (!letter) return;
    setBusy(true);
    setProblem(null);
    try {
      update((await api.onboarding.acceptMyLetter({ letterId: letter.id, version: letter.version })).page);
      notify("Accepted. Thank you: a copy is on this page.");
    } catch (e) {
      setProblem(describe(e));
      // Made again while they were reading: the new version is shown to read again.
      if (e instanceof ApiError && e.code === "LETTER_CHANGED") retry();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Frame back>
      <PageHeader title="Your appointment letter" />
      {!letter ? (
        <Card>
          <p className="font-semibold">ECCS is preparing your letter.</p>
          <p className="mt-1 text-muted">It needs your date of birth and address from your details first.</p>
        </Card>
      ) : (
        <>
          {letter.status === "ACCEPTED" ? (
            <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm font-semibold" style={{ color: "#2E7D32" }}>
              ✓ {letter.acceptedHow === "PAPER" ? `Signed on paper; recorded ${when(letter.acceptedAt!)}.` : `You accepted this letter on ${when(letter.acceptedAt!)}.`}
            </p>
          ) : (
            letter.remadeFor.length > 0 && <p className="text-sm text-muted">Made again after a change: {letter.remadeFor.join(", ").toLowerCase()}.</p>
          )}
          <Card>
            <LetterText letter={letter} />
          </Card>
          {letter.status === "WAITING" && (
            <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
              <p className="text-sm">Tapping &ldquo;I accept&rdquo; records that you accept these terms, with the time. It counts as signing the letter.</p>
              <ErrorMessage message={problem} />
              <Button onClick={() => void accept()} loading={busy} className="w-full sm:w-fit">
                I accept
              </Button>
            </div>
          )}
          <Button variant="link" className="w-fit text-sm" onClick={() => void openFile(() => api.onboarding.letterPdf(letter.id), `Appointment letter ${letter.number.replace(/\//g, "-")}.pdf`, notify)}>
            Open it as a PDF
          </Button>
        </>
      )}
    </Frame>
  );
}

// ───────────────────────── The handbook ─────────────────────────

export function JoiningHandbookPage() {
  const { page, error, retry, update } = useJoining();
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!page) return <NotYet page={page} error={error} retry={retry} back />;
  const handbook = page.handbook;
  const accepted = handbook && page.handbookAccepted?.version === handbook.version ? page.handbookAccepted : null;

  async function accept() {
    if (!handbook) return;
    setBusy(true);
    setProblem(null);
    try {
      update((await api.onboarding.acceptHandbook(handbook.version)).page);
      notify("Accepted. Thank you.");
    } catch (e) {
      setProblem(describe(e));
      retry();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Frame back>
      <PageHeader title={handbook?.title ?? "Staff handbook"} description={handbook ? `Version ${handbook.version}` : undefined} />
      {!handbook ? (
        <Card>
          <p className="font-semibold">The handbook is not ready yet.</p>
        </Card>
      ) : (
        <>
          {accepted && (
            <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm font-semibold" style={{ color: "#2E7D32" }}>
              ✓ You accepted this version on {when(accepted.acceptedAt)}.
            </p>
          )}
          <Card>
            <HandbookText body={handbook.body} />
          </Card>
          {!accepted && (
            <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
              <ErrorMessage message={problem} />
              <Button onClick={() => void accept()} loading={busy} className="w-full sm:w-fit">
                I have read it and I accept it
              </Button>
            </div>
          )}
        </>
      )}
    </Frame>
  );
}
