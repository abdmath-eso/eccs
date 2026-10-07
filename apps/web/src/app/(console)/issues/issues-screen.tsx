"use client";

import { isIssueOpen, type IssueCategory, type IssueDto, type IssueStatus, type IssueSummaryDto } from "@eccs/shared";
import { useEffect, useState, type FormEvent } from "react";

import { MasterDetail } from "@/components/master-detail";
import { useToast } from "@/components/toast";
import { Button, Card, ErrorMessage, Field, Loading, TextAreaField, ToggleGroup } from "@/components/ui";
import { api } from "@/lib/api";
import { describe, matchesSearch, when } from "@/lib/format";
import { useNavCounts } from "@/lib/nav-counts";
import { isPlainClick, useQuery, useQueryField } from "@/lib/query";

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
  CLOSED: { label: "Closed", style: "border-border-strong text-muted" },
};

function StatusBadge({ status }: { status: IssueStatus }) {
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS[status].style}`}>
      {STATUS[status].label}
    </span>
  );
}

/**
 * Issues restaurants have raised with ECCS through the app's support screen.
 * Problems noted on a restaurant's daily checklists are not sent to ECCS and do not appear here.
 *
 * What is being looked at lives in the web address: `show=all` to include
 * resolved issues, `q=` for the search and `issue=` for the one that is open.
 */
export default function IssuesScreen() {
  const query = useQuery();
  const notify = useToast();
  const { refresh: refreshCounts } = useNavCounts();

  const openOnly = query.get("show") !== "all";
  const [search, setSearch] = useQueryField("q");
  const issueId = query.get("issue");

  // Kept with the filter it was fetched for, so switching never shows the other list while the new one loads.
  const [loaded, setLoaded] = useState<{ openOnly: boolean; list: IssueSummaryDto[] } | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listAttempt, setListAttempt] = useState(0);
  const [detail, setDetail] = useState<IssueDto | null>(null);
  const [detailError, setDetailError] = useState<{ id: string; message: string } | null>(null);
  const [detailAttempt, setDetailAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.issues
      .list({ openOnly })
      .then((list) => {
        if (cancelled) return;
        setLoaded({ openOnly, list });
        setListError(null);
      })
      .catch((e) => !cancelled && setListError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [openOnly, listAttempt]);

  useEffect(() => {
    if (!issueId) return;
    let cancelled = false;
    api.issues
      .get(issueId)
      .then((issue) => !cancelled && setDetail(issue))
      .catch((e) => !cancelled && setDetailError({ id: issueId, message: describe(e) }));
    return () => {
      cancelled = true;
    };
  }, [issueId, detailAttempt]);

  /** Keeps the list row in step after a reply or status change in the detail panel, and says what was done. */
  function updated(issue: IssueDto, message: string) {
    setDetail(issue);
    setLoaded(
      (current) =>
        current && {
          ...current,
          list: current.list
            .map((row) => (row.id === issue.id ? { ...row, status: issue.status, commentCount: issue.comments.length } : row))
            // An issue just resolved stays in view while it is open on the right, so it does not vanish under the person.
            .filter((row) => !current.openOnly || isIssueOpen(row.status) || row.id === issue.id),
        },
    );
    refreshCounts();
    notify(message);
  }

  const issues = loaded && loaded.openOnly === openOnly ? loaded.list : null;
  const openIssue = detail && detail.id === issueId ? detail : null;
  const openError = detailError && detailError.id === issueId ? detailError.message : null;

  const matching = (issues ?? []).filter((issue) =>
    matchesSearch(search, [
      issue.reference,
      issue.organizationName,
      issue.outletName,
      CATEGORY[issue.category],
      issue.description,
      issue.raisedByName,
    ]),
  );

  const detailPanel = openIssue ? (
    <IssueDetail key={openIssue.id} issue={openIssue} onUpdated={updated} />
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
  ) : issueId ? (
    <Card>
      <Loading>Opening the issue…</Loading>
    </Card>
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Issues</h1>
        <p className="text-muted">Raised by restaurants through ECCS support in the app.</p>
      </div>

      <div className={`${issueId ? "hidden lg:flex" : "flex"} flex-wrap items-end justify-between gap-x-6 gap-y-3`}>
        <Field
          label="Search issues"
          type="search"
          plainLabel
          hint="By client, outlet, reference or words in the issue."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          wrapperClassName="w-full max-w-md"
        />
        <ToggleGroup
          label="Which issues to show"
          value={openOnly ? "open" : "all"}
          options={[
            { value: "open", label: "Needs attention" },
            { value: "all", label: "All" },
          ]}
          onChange={(value) => query.set({ show: value === "all" ? "all" : null }, "replace")}
        />
      </div>

      <MasterDetail
        detail={detailPanel}
        detailLabel="Issue details"
        placeholder="Select an issue to see its photos and reply."
        backHref={query.hrefWith({ issue: null })}
        onBack={() => query.set({ issue: null })}
        list={
          <>
            {listError && (
              <div className="flex flex-col items-start gap-3">
                <ErrorMessage message={listError} />
                <Button variant="secondary" onClick={() => setListAttempt((current) => current + 1)}>
                  Try again
                </Button>
              </div>
            )}
            {issues === null && !listError && <Loading />}
            {issues?.length === 0 && (
              <p className="text-muted">{openOnly ? "Nothing needs attention right now." : "No issues have been raised yet."}</p>
            )}
            {issues && issues.length > 0 && search && (
              <p role="status" className="text-sm text-muted">
                {matching.length === 0 ? `No issues match "${search}".` : `Showing ${matching.length} of ${issues.length} issues.`}
              </p>
            )}
            <ul className="flex flex-col gap-3">
              {matching.map((issue) => {
                const selected = issue.id === issueId;
                const opening = selected && !openIssue && !openError;
                return (
                  <li key={issue.id}>
                    <a
                      href={query.hrefWith({ issue: issue.id })}
                      onClick={(event) => {
                        if (!isPlainClick(event)) return;
                        event.preventDefault();
                        if (!selected) query.set({ issue: issue.id });
                      }}
                      aria-current={selected ? "true" : undefined}
                      aria-busy={opening || undefined}
                      className={`block rounded-xl border bg-surface p-4 hover:border-primary ${
                        selected ? "border-primary ring-2 ring-primary" : "border-border"
                      }`}
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span className="font-semibold">{CATEGORY[issue.category]}</span>
                        <StatusBadge status={issue.status} />
                      </span>
                      <span className="mt-1 block text-sm">
                        {issue.organizationName} · {issue.outletName}
                      </span>
                      <span className="mt-2 line-clamp-2 text-sm text-muted">{issue.description}</span>
                      <span className="mt-2 block text-xs text-muted">
                        {issue.reference} · {issue.raisedByName} · {when(issue.createdAt)}
                        {issue.photoCount > 0 ? ` · ${issue.photoCount} photo${issue.photoCount > 1 ? "s" : ""}` : ""}
                        {issue.commentCount > 0 ? ` · ${issue.commentCount} message${issue.commentCount > 1 ? "s" : ""}` : ""}
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

function IssueDetail({ issue, onUpdated }: { issue: IssueDto; onUpdated: (issue: IssueDto, message: string) => void }) {
  const [reply, setReply] = useState("");
  const [replyError, setReplyError] = useState<string>();
  // Which action is under way, so only its own button shows "Please wait…" and its own error appears beside it.
  const [busy, setBusy] = useState<IssueStatus | "reply" | null>(null);
  const [error, setError] = useState<{ on: "status" | "reply"; message: string } | null>(null);

  async function act(what: IssueStatus | "reply", action: () => Promise<IssueDto>, message: string, after?: () => void) {
    setBusy(what);
    setError(null);
    try {
      onUpdated(await action(), message);
      after?.();
    } catch (e) {
      setError({ on: what === "reply" ? "reply" : "status", message: describe(e) });
    } finally {
      setBusy(null);
    }
  }

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reply.trim()) {
      setReplyError("Write a message first.");
      event.currentTarget.querySelector("textarea")?.focus();
      return;
    }
    setReplyError(undefined);
    void act("reply", () => api.issues.comment(issue.id, { body: reply.trim() }), "Reply sent", () => setReply(""));
  }

  const setStatus = (status: IssueStatus, message: string) => void act(status, () => api.issues.setStatus(issue.id, status), message);

  return (
    <Card className="flex flex-col gap-4">
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
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {issue.photoPaths.map((path) => (
            <a key={path} href={api.fileUrl(path)} target="_blank" rel="noreferrer">
              {/* Photos come from the API through short-lived signed links, so the image optimiser is not used. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={api.fileUrl(path)} alt="Photo attached to the issue" className="h-40 w-full rounded-lg object-cover" />
            </a>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {issue.status !== "IN_PROGRESS" && (
            <Button
              variant="secondary"
              loading={busy === "IN_PROGRESS"}
              disabled={busy !== null}
              onClick={() => setStatus("IN_PROGRESS", isIssueOpen(issue.status) ? "Issue marked in progress" : "Issue reopened")}
            >
              {isIssueOpen(issue.status) ? "Mark in progress" : "Reopen as in progress"}
            </Button>
          )}
          {issue.status !== "RESOLVED" && issue.status !== "CLOSED" && (
            <Button loading={busy === "RESOLVED"} disabled={busy !== null} onClick={() => setStatus("RESOLVED", "Issue marked resolved")}>
              Mark resolved
            </Button>
          )}
        </div>
        {error?.on === "status" && <ErrorMessage message={error.message} />}
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

      <form onSubmit={send} noValidate className="flex flex-col gap-2">
        <TextAreaField
          label="Reply to the restaurant"
          name="reply"
          required
          value={reply}
          error={replyError}
          onChange={(e) => {
            setReply(e.target.value);
            if (replyError) setReplyError(undefined);
          }}
          maxLength={1000}
          rows={3}
        />
        {error?.on === "reply" && <ErrorMessage message={error.message} />}
        <div>
          <Button type="submit" loading={busy === "reply"} disabled={busy !== null}>
            Send reply
          </Button>
        </div>
      </form>
    </Card>
  );
}
