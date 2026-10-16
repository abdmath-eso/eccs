"use client";

import { can, firstName, leaveWords, WEEKDAY_NAMES, type TeamMemberDto } from "@eccs/shared";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { Button, LoadError, Loading, NoAccess } from "@/components/ui";
import { api } from "@/lib/api";
import { describe } from "@/lib/format";
import { useNavCounts } from "@/lib/nav-counts";
import { useSession } from "@/lib/session";

import { dayMonth, Panel, SampleBadge } from "../../finance/finance-parts";
import { DayLegend, DaySquares, Initials, LeaveSheet, LeftSheet, longDate, MemberSheet, roleLine, salaryWords } from "../team-parts";

// One person on ECCS's own team (16 Oct 2026), to the founder's design (docs/design/
// 2026-10-15 Team member page): who they are, with See their leads and Message; the one
// thing to keep an eye on and today in a sentence; three figures against target and last
// week; the last 14 days as one square a day; what the app found; and, at the end, their
// details, leave and (for the Super Admin) salary.
//
// PATTERN FOLLOWED: the founder's design, itself the shape of a rep's page in Pipedrive
// Insights and HubSpot's rep productivity report (a handful of figures, each against its goal
// and the last period), GitHub's contribution graph for the days, LeadSquared's user page
// (today's check-in, their leads, call or WhatsApp from it), and Pipedrive's rotting deals
// for "What the app found".

export default function MemberScreen({ userId }: { userId: string }) {
  const { user } = useSession();
  const allowed = user ? can(user.memberships, "team", "read") : false;
  if (!allowed) return <NoAccess title="Team">The Team page is for the founders and the Ops Manager.</NoAccess>;
  return <Member userId={userId} />;
}

type SheetName = "change" | "leave" | "left" | null;

function Member({ userId }: { userId: string }) {
  const { user } = useSession();
  const notify = useToast();
  const confirm = useConfirm();
  const { refresh: refreshCounts } = useNavCounts();
  const [loaded, setLoaded] = useState<TeamMemberDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [sheet, setSheet] = useState<SheetName>(null);
  const seesPay = user ? can(user.memberships, "team", "approve") : false;

  useEffect(() => {
    let cancelled = false;
    api.eccsTeam
      .member(userId)
      .then((member) => {
        if (cancelled) return;
        setLoaded(member);
        setError(null);
      })
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [userId, attempt]);

  const back = (
    <Link href="/team" className="w-fit rounded-md text-sm font-semibold text-primary hover:underline">
      ← Team
    </Link>
  );
  const member = loaded?.userId === userId ? loaded : null;
  if (!member) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        {error ? <LoadError message={error} onRetry={() => setAttempt((value) => value + 1)} /> : <Loading />}
      </div>
    );
  }

  const saved = (next: TeamMemberDto) => {
    setLoaded(next);
    refreshCounts();
  };
  const who = firstName(member.name);
  const sells = member.role === "BDE" || member.openLeads > 0;

  async function removeLeave(leaveId: string, words: string) {
    const sure = await confirm({ title: `Remove the leave on ${words}?`, body: "The day goes back to being read from what they did.", confirmLabel: "Remove the leave", cancelLabel: "Keep it" });
    if (!sure) return;
    try {
      await api.eccsTeam.removeLeave(leaveId);
      notify("Leave removed");
      setAttempt((value) => value + 1);
    } catch (e) {
      notify(describe(e));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {back}

      {/* ── Who they are ── */}
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-center gap-4">
          <Initials text={member.initials} size="lg" />
          <div className="min-w-0">
            <h1 className="text-3xl font-bold">{member.name}</h1>
            <p className="text-sm text-muted">
              {roleLine(member)}
              {member.isSample && (
                <span className="ml-2 align-middle">
                  <SampleBadge />
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {sells && (
            <Link href={`/sales/leads?owner=${encodeURIComponent(member.userId)}&state=open`} className="rounded-lg border border-border-strong bg-surface px-4 py-2.5 font-semibold hover:bg-background">
              See {who}&apos;s leads
            </Link>
          )}
          {!member.leftOn && member.phone && (
            <a
              href={member.whatsappUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => member.isSample && notify("A sample team member: the number is made up, so WhatsApp asks whom to write to.")}
              className="rounded-lg bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-hover"
            >
              Message {who}
            </a>
          )}
        </div>
      </header>

      {/* ── Keep an eye on, and today ── */}
      <KeepAnEyeOn member={member} />

      {/* ── Three figures against target and last week ── */}
      {member.cards.length > 0 && (
        // Three across even on a phone, smaller there, so the squares and the list stay near the top.
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {member.cards.map((card) => (
            <div key={card.key} className="flex min-w-0 flex-col gap-0.5 rounded-xl border border-border bg-surface p-3 sm:p-5">
              <span className="text-xs text-muted sm:text-sm">{card.label}</span>
              <span className="text-2xl font-bold tracking-tight tabular-nums sm:text-3xl">{card.value}</span>
              <span className="text-xs text-muted sm:text-sm">{[card.target, card.lastWeek].filter(Boolean).join(" · ")}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── The last 14 days ── */}
      <Panel
        title="Last 14 days"
        action={
          member.canRecordLeave ? (
            <Button variant="link" className="text-sm" onClick={() => setSheet("leave")}>
              Record leave
            </Button>
          ) : undefined
        }
      >
        <DaySquares days={member.days} />
        <p className="text-sm text-muted">{member.presenceLine}</p>
        <DayLegend days={member.days} />
        {member.leave.length > 0 && (
          <ul className="flex flex-col gap-1 border-t border-border pt-3 text-sm">
            {member.leave.map((span) => (
              <li key={span.id} className="flex flex-wrap items-center gap-x-2">
                <span className="font-medium">Leave {leaveWords(span)}</span>
                {span.reason && <span className="text-muted">({span.reason})</span>}
                {member.canRecordLeave && (
                  <Button variant="link" className="text-sm" onClick={() => void removeLeave(span.id, leaveWords(span))}>
                    Remove<span className="sr-only"> the leave on {leaveWords(span)}</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* ── What the app found ── */}
      <Found member={member} />

      {/* ── Details, leave and salary ── */}
      <Panel
        title="Details"
        action={
          member.canManage && member.role !== "SUPER_ADMIN" && !member.leftOn ? (
            <span className="flex gap-1">
              <Button variant="link" className="text-sm" onClick={() => setSheet("change")}>
                {member.memberId ? "Change" : "Add details"}
              </Button>
              {member.memberId && (
                <Button variant="link" className="text-sm text-danger" onClick={() => setSheet("left")}>
                  Mark as left
                </Button>
              )}
            </span>
          ) : member.canManage && member.role === "SUPER_ADMIN" ? (
            <Button variant="link" className="text-sm" onClick={() => setSheet("change")}>
              Change
            </Button>
          ) : undefined
        }
      >
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
          <Detail label="Login">{member.phone ? `${member.phone.replace(/^\+91/, "+91 ")} with a one-time code` : "—"}</Detail>
          <Detail label="Joined">{member.joinedOn ? longDate(member.joinedOn) : "Not given yet"}</Detail>
          {member.leftOn && <Detail label="Left">{longDate(member.leftOn)}: the login no longer works</Detail>}
          <Detail label="Weekly day off">{WEEKDAY_NAMES[member.weeklyOff]}</Detail>
          {member.salary && <Detail label="Monthly salary">{member.salary.history.length > 0 ? salaryWords(member.salary.history) : "None set"}</Detail>}
        </dl>
        {member.salary && <p className="text-sm text-muted">Each month&apos;s salary goes into the Finance page as a payout due, counted from the joining day; leave days are paid.</p>}
      </Panel>

      <MemberSheet open={sheet === "change"} member={member} seesPay={seesPay} onClose={() => setSheet(null)} onSaved={saved} />
      <LeaveSheet member={sheet === "leave" ? member : null} onClose={() => setSheet(null)} onSaved={saved} />
      <LeftSheet member={sheet === "left" ? member : null} onClose={() => setSheet(null)} onSaved={saved} />
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

/** The banner of the design: an amber edge and dot when there is something to keep an eye on. */
function KeepAnEyeOn({ member }: { member: TeamMemberDto }) {
  const { pick, note } = member.keep;
  const edge = pick ? "#B26A00" : "#2E7D32";
  return (
    <section aria-label="Keep an eye on" className="flex gap-3 rounded-xl border border-border border-l-4 bg-surface px-5 py-4" style={{ borderLeftColor: edge }}>
      <span aria-hidden className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: edge }} />
      <div className="min-w-0">
        <p className="font-bold">{pick ? `Keep an eye on: ${pick.words.charAt(0).toLowerCase()}${pick.words.slice(1)}` : "Nothing to keep an eye on."}</p>
        <p className="text-sm text-muted">{note}</p>
      </div>
    </section>
  );
}

/** "What the app found": a BDE's stale leads worst first, or a Supervisor's visits past their day. */
function Found({ member }: { member: TeamMemberDto }) {
  const who = firstName(member.name);
  if (member.foundLeads) {
    const { items, total } = member.foundLeads;
    return (
      <Panel title="What the app found" action={total > items.length ? <Link href={`/sales/leads?owner=${encodeURIComponent(member.userId)}&state=stale`} className="text-sm font-semibold text-primary hover:underline">All {total}</Link> : undefined}>
        {items.length === 0 ? (
          <p className="text-sm text-muted">No lead is waiting: every one has had a step in the last five days and no next step has passed.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border border-t border-border">
            {items.map((item) => (
              <li key={item.leadId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5">
                <span className="min-w-0">
                  <Link href={`/sales/leads/${item.leadId}`} className="font-semibold hover:underline">
                    {item.businessName}
                  </Link>{" "}
                  <span className="text-sm text-muted">{item.stale.context}</span>
                </span>
                <span className="text-sm text-muted">{item.stale.words}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-muted">
          A lead goes on this list when it has had no activity for 5 days or its next-action date has passed. It leaves the list on its own when {who} logs the next step.
        </p>
      </Panel>
    );
  }
  if (member.foundVisits) {
    const { items, total } = member.foundVisits;
    return (
      <Panel title="What the app found">
        {items.length === 0 ? (
          <p className="text-sm text-muted">No visit given to {who} is past its day.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border border-t border-border">
            {items.map((item) => (
              <li key={item.visitId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5">
                <span className="min-w-0">
                  <Link href={`/visits?visit=${encodeURIComponent(item.visitId)}`} className="font-semibold hover:underline">
                    {item.outletName}
                  </Link>{" "}
                  <span className="text-sm text-muted">
                    {item.serviceName}, booked for {dayMonth(item.scheduledDate)}
                  </span>
                </span>
                <span className="text-sm text-muted">not done, {item.daysLate === 1 ? "1 day" : `${item.daysLate} days`} late</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-muted">
          A visit goes on this list when its day has passed and it is not done.{total > items.length ? ` ${total - items.length} more are on the Visits page.` : ""} It leaves the list when {who} finishes it or it is moved.
        </p>
      </Panel>
    );
  }
  return null;
}
