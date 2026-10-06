"use client";

import { ApiError } from "@eccs/api-client";
import { isIssueOpen, type IssueCategory, type IssueDto, type IssueStatus, type IssueSummaryDto } from "@eccs/shared";
import { useEffect, useState, type FormEvent } from "react";

import { Button, Card, ErrorMessage } from "@/components/ui";
import { api } from "@/lib/api";

const CATEGORY: Record<IssueCategory, string> = {
  PEST_SIGHTING: "Pest sighting",
  CHIMNEY: "Chimney or exhaust",
  EQUIPMENT: "Equipment",
  HYGIENE: "Cleaning or hygiene",
  SUPPORT: "Help with the app or service",
  OTHER: "Something else",
};

const STATUS: Record<IssueStatus, { label: string; style: string }> = {
  OPEN: { label: "Open", style: "border-danger text-danger" },
  IN_PROGRESS: { label: "In progress", style: "border-foreground text-foreground" },
  RESOLVED: { label: "Resolved", style: "border-primary text-primary" },
  CLOSED: { label: "Closed", style: "border-border text-muted" },
};

const describe = (error: unknown) =>
  error instanceof ApiError
    ? error.isNetworkError
      ? "Could not reach the server. Is the API running?"
      : error.message
    : "Something went wrong. Try again.";

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));

function StatusBadge({ status }: { status: IssueStatus }) {
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS[status].style}`}>
      {STATUS[status].label}
    </span>
  );
}

/**
 * Issues restaurants have raised with ECCS through the app's support screen.
 * Problems noted on a restaurant's daily checklists are not sent to ECCS and do not appear here.
 */
export default function IssuesPage() {
  const [issues, setIssues] = useState<IssueSummaryDto[] | null>(null);
  const [openOnly, setOpenOnly] = useState(true);
  const [selected, setSelected] = useState<IssueDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.issues
      .list({ openOnly })
      .then((list) => !cancelled && setIssues(list))
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [openOnly]);

  async function open(issueId: string) {
    setError(null);
    try {
      setSelected(await api.issues.get(issueId));
    } catch (e) {
      setError(describe(e));
    }
  }

  /** Keeps the list row in step after a reply or status change in the detail panel. */
  function updated(issue: IssueDto) {
    setSelected(issue);
    setIssues((current) =>
      (current ?? [])
        .map((row) => (row.id === issue.id ? { ...row, status: issue.status, commentCount: issue.comments.length } : row))
        .filter((row) => !openOnly || isIssueOpen(row.status) || row.id === issue.id),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Issues</h1>
          <p className="text-muted">Raised by restaurants through ECCS support in the app.</p>
        </div>
        <div className="flex gap-2" role="group" aria-label="Which issues to show">
          <Button variant={openOnly ? "primary" : "secondary"} onClick={() => setOpenOnly(true)}>
            Needs attention
          </Button>
          <Button variant={openOnly ? "secondary" : "primary"} onClick={() => setOpenOnly(false)}>
            All
          </Button>
        </div>
      </div>

      <ErrorMessage message={error} />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          {issues === null && !error && <p className="text-muted">Loading…</p>}
          {issues?.length === 0 && (
            <p className="text-muted">{openOnly ? "Nothing needs attention right now." : "No issues have been raised yet."}</p>
          )}
          {issues?.map((issue) => (
            <button
              key={issue.id}
              onClick={() => void open(issue.id)}
              className={`cursor-pointer rounded-xl border bg-surface p-4 text-left hover:border-primary ${
                selected?.id === issue.id ? "border-primary ring-2 ring-primary/20" : "border-border"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="font-semibold">{CATEGORY[issue.category]}</span>
                <StatusBadge status={issue.status} />
              </div>
              <p className="mt-1 text-sm">
                {issue.organizationName} · {issue.outletName}
              </p>
              <p className="mt-2 line-clamp-2 text-sm text-muted">{issue.description}</p>
              <p className="mt-2 text-xs text-muted">
                {issue.reference} · {issue.raisedByName} · {when(issue.createdAt)}
                {issue.photoCount > 0 ? ` · ${issue.photoCount} photo${issue.photoCount > 1 ? "s" : ""}` : ""}
                {issue.commentCount > 0 ? ` · ${issue.commentCount} message${issue.commentCount > 1 ? "s" : ""}` : ""}
              </p>
            </button>
          ))}
        </div>

        {selected ? (
          <IssueDetail issue={selected} onUpdated={updated} />
        ) : (
          <Card className="hidden text-muted lg:block">Select an issue to see its photos and reply.</Card>
        )}
      </div>
    </div>
  );
}

function IssueDetail({ issue, onUpdated }: { issue: IssueDto; onUpdated: (issue: IssueDto) => void }) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: () => Promise<IssueDto>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await action());
      after?.();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  function send(event: FormEvent) {
    event.preventDefault();
    if (!reply.trim()) return;
    void act(() => api.issues.comment(issue.id, { body: reply.trim() }), () => setReply(""));
  }

  const setStatus = (status: IssueStatus) => void act(() => api.issues.setStatus(issue.id, status));

  return (
    <Card className="flex flex-col gap-4 lg:sticky lg:top-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{CATEGORY[issue.category]}</h2>
          <p className="text-sm text-muted">
            {issue.reference} · {issue.organizationName} · {issue.outletName}
          </p>
        </div>
        <StatusBadge status={issue.status} />
      </div>

      <p className="whitespace-pre-wrap">{issue.description}</p>
      <p className="text-sm text-muted">
        Raised by {issue.raisedByName} on {when(issue.createdAt)}
      </p>

      {issue.photoPaths.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {issue.photoPaths.map((path) => (
            <a key={path} href={api.fileUrl(path)} target="_blank" rel="noreferrer">
              {/* Photos come from the API through short-lived signed links, so the image optimiser is not used. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={api.fileUrl(path)} alt="Photo attached to the issue" className="h-40 w-full rounded-lg object-cover" />
            </a>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {issue.status !== "IN_PROGRESS" && (
          <Button variant="secondary" disabled={busy} onClick={() => setStatus("IN_PROGRESS")}>
            {isIssueOpen(issue.status) ? "Mark in progress" : "Reopen as in progress"}
          </Button>
        )}
        {issue.status !== "RESOLVED" && issue.status !== "CLOSED" && (
          <Button disabled={busy} onClick={() => setStatus("RESOLVED")}>
            Mark resolved
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="text-sm font-semibold text-muted">Messages</h3>
        {issue.comments.length === 0 && <p className="text-sm text-muted">No messages yet.</p>}
        {issue.comments.map((comment) => (
          <div
            key={comment.id}
            className={`max-w-[88%] rounded-xl border p-3 text-sm ${
              comment.fromEccs ? "self-end border-primary bg-primary/5" : "self-start border-border bg-background"
            }`}
          >
            <p className="font-semibold">{comment.fromEccs ? `ECCS · ${comment.authorName}` : comment.authorName}</p>
            <p className="whitespace-pre-wrap">{comment.body}</p>
            <p className="mt-1 text-xs text-muted">{when(comment.createdAt)}</p>
          </div>
        ))}
      </div>

      <form onSubmit={send} className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Reply to the restaurant
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            maxLength={1000}
            rows={3}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-base font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>
        <ErrorMessage message={error} />
        <div>
          <Button type="submit" loading={busy} disabled={!reply.trim()}>
            Send reply
          </Button>
        </div>
      </form>
    </Card>
  );
}
