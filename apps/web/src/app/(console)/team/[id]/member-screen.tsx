"use client";

import { can, firstName, lastLoginWords, leaveWords, TEAM_ROLE_LABELS, WEEKDAY_NAMES, type PersonOnboardingDto, type TeamMemberDto } from "@eccs/shared";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { Button, HowItWorks, LoadError, Loading, NoAccess } from "@/components/ui";
import { api } from "@/lib/api";
import { describe, today } from "@/lib/format";
import { useNavCounts } from "@/lib/nav-counts";
import { useSession } from "@/lib/session";

import { dayMonth, Panel, SampleBadge } from "../../finance/finance-parts";
import { ChecklistPanel, DocumentsPanel, FilePanel, LetterPanel } from "../onboarding-parts";
import { DayLegend, DaySquares, Initials, LeaveSheet, LeftSheet, longDate, MemberSheet, roleLine, salaryWords } from "../team-parts";

// One person on ECCS's own team (16 Oct 2026), to the founder's design (docs/design/
// 2026-10-15 Team member page): who they are, with See their leads and Message; the one
// thing to keep an eye on and today in a sentence; three figures against target and last
// week; the last 14 days as one square a day; what the app found; and, at the end, their
// details, leave and (for the Super Admin) salary.
// Onboarding (16 Oct 2026): while it is open, its checklist is at the top and (for the Super
// Admin) the joining file, documents and letter come before Details; before the joining day
// the figures and squares, which would be empty, are left out. Done, the checklist folds into
// one line under Details, with the file after it.
// Document dates and console access (20 Oct 2026, the console plan's Team part): a short
// "Documents due" line near the top when a document has run out, runs out within 30 days or is
// missing; each document's date on its row; and, last, the Console access card (role, what it
// opens, the last login, Mark as left).
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
  // Onboarding (16 Oct 2026): the checklist (the Super Admin and the Ops Manager) and the papers (the Super Admin).
  const [onboarding, setOnboarding] = useState<(PersonOnboardingDto & { userId: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [sheet, setSheet] = useState<SheetName>(null);
  const seesPay = user ? can(user.memberships, "team", "approve") : false;

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.eccsTeam.member(userId), api.onboarding.person(userId).catch(() => null)])
      .then(([member, person]) => {
        if (cancelled) return;
        setLoaded(member);
        setOnboarding(person ? { ...person, userId } : null);
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
    // A change of pay or role makes a waiting letter again: the papers are read afresh.
    void api.onboarding
      .person(next.userId)
      .then((person) => setOnboarding({ ...person, userId: next.userId }))
      .catch(() => undefined);
  };
  const onboardingChanged = (next: PersonOnboardingDto) => {
    setOnboarding({ ...next, userId });
    refreshCounts();
    void api.eccsTeam
      .member(userId)
      .then(setLoaded)
      .catch(() => undefined);
  };
  const person = onboarding?.userId === userId ? onboarding : null;
  const checklist = person?.onboarding ?? null;
  const open = checklist !== null && !checklist.progress.doneOn;
  const joinsLater = Boolean(member.joinedOn && member.joinedOn > today());

  async function startOnboarding() {
    try {
      const next = await api.onboarding.start(userId);
      onboardingChanged(next);
      notify(`Onboarding started: ${next.onboarding?.progress.total ?? 0} tasks from the ${TEAM_ROLE_LABELS[member!.role]} checklist`);
    } catch (e) {
      notify(describe(e));
    }
  }
  const papers = checklist && checklist.file ? (
    <>
      <FilePanel data={checklist} member={member} onChange={onboardingChanged} />
      <DocumentsPanel data={checklist} member={member} onChange={onboardingChanged} />
      <LetterPanel data={checklist} member={member} onChange={onboardingChanged} />
    </>
  ) : null;
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

      {/* ── Documents past their date, near it, or missing (20 Oct 2026): one short line near the top ── */}
      {!member.leftOn && member.dueDocuments.length > 0 && <DocumentsDue member={member} toDocuments={Boolean(papers)} />}

      {/* ── Onboarding, at the top while it is open (main part first) ── */}
      {open && checklist && <ChecklistPanel data={checklist} member={member} onChange={onboardingChanged} />}

      {/* ── Keep an eye on, and today (before the joining day, only when something is late) ── */}
      {(!joinsLater || member.keep.pick) && <KeepAnEyeOn member={member} />}

      {/* ── Three figures against target and last week ── */}
      {!joinsLater && member.cards.length > 0 && (
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

      {/* ── The last 14 days (nothing to show before the joining day) ── */}
      {!joinsLater && (
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
      )}

      {/* ── What the app found ── */}
      {!joinsLater && <Found member={member} />}

      {/* ── The joining file, documents and letter while onboarding is open (the Super Admin) ── */}
      {open && papers}

      {/* ── Details, leave and salary ── */}
      <Panel
        title="Details"
        action={
          member.canManage && member.role !== "SUPER_ADMIN" && !member.leftOn ? (
            <span className="flex flex-wrap gap-1">
              {person?.canStart && (
                <Button variant="link" className="text-sm" onClick={() => void startOnboarding()}>
                  Start onboarding
                </Button>
              )}
              <Button variant="link" className="text-sm" onClick={() => setSheet("change")}>
                {member.memberId ? "Change" : "Add details"}
              </Button>
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
          <Detail label={joinsLater ? "Joins" : "Joined"}>{member.joinedOn ? longDate(member.joinedOn) : "Not given yet"}</Detail>
          {member.leftOn && <Detail label="Left">{longDate(member.leftOn)}: the login no longer works</Detail>}
          <Detail label="Weekly day off">{WEEKDAY_NAMES[member.weeklyOff]}</Detail>
          {member.salary && <Detail label="Monthly salary">{member.salary.history.length > 0 ? salaryWords(member.salary.history) : "None set"}</Detail>}
        </dl>
        {member.salary && <p className="text-sm text-muted">Each month&apos;s salary goes into the Finance page as a payout due, counted from the joining day; leave days are paid.</p>}
      </Panel>

      {/* ── Onboarding done: one line, and the file stays here under Details ── */}
      {!open && checklist && <ChecklistPanel data={checklist} member={member} onChange={onboardingChanged} />}
      {!open && papers}

      {/* ── Console access: their role, what it opens, the last login, and Mark as left (20 Oct 2026) ── */}
      <AccessCard member={member} onMarkLeft={member.canManage && member.role !== "SUPER_ADMIN" && !member.leftOn && member.memberId ? () => setSheet("left") : null} />

      <MemberSheet open={sheet === "change"} member={member} seesPay={seesPay} onClose={() => setSheet(null)} onSaved={saved} />
      <LeaveSheet member={sheet === "leave" ? member : null} onClose={() => setSheet(null)} onSaved={saved} />
      <LeftSheet member={sheet === "left" ? member : null} onClose={() => setSheet(null)} onSaved={saved} />
    </div>
  );
}

/**
 * "Documents due" (20 Oct 2026): one line near the top naming what has run out, runs out within
 * 30 days, or is missing, with a link down to the documents for the Super Admin, who checks them.
 * An amber edge and a "!" mark with the words, so colour is never the only sign.
 */
function DocumentsDue({ member, toDocuments }: { member: TeamMemberDto; toDocuments: boolean }) {
  const due = member.dueDocuments;
  return (
    <section aria-label="Documents due" className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl border border-border border-l-4 bg-surface px-5 py-3" style={{ borderLeftColor: "#B26A00" }}>
      <p className="min-w-0 text-sm">
        <span aria-hidden className="font-bold" style={{ color: "#8A5300" }}>
          !{" "}
        </span>
        <span className="font-bold">{due.length === 1 ? "Document due: " : `${due.length} documents due: `}</span>
        {due.map((entry) => entry.words).join(" · ")}
      </p>
      {toDocuments && (
        <a href="#documents" className="text-sm font-semibold text-primary hover:underline">
          See the documents
        </a>
      )}
    </section>
  );
}

/**
 * The console access card (20 Oct 2026): the person's role, what that role opens in the console
 * (from the grants alone: roles are fixed, there are no sections set per person), whether the
 * login is on, the last login from the console or the phone app, and Mark as left, which ends it.
 *
 * PATTERN FOLLOWED: Google Workspace's user page (the admin role, the last sign-in, and Suspend,
 * which signs the person out everywhere) and GitHub's organisation member page (the role and what
 * it grants, said in words). The section list is short; what each section is for is folded away.
 */
function AccessCard({ member, onMarkLeft }: { member: TeamMemberDto; onMarkLeft: (() => void) | null }) {
  const { access } = member;
  const lastLogin = lastLoginWords(access.lastLoginAt, new Date());
  const where = access.lastLoginIn === "CONSOLE" ? "in the console" : access.lastLoginIn === "APP" ? "in the phone app" : null;
  return (
    <Panel
      title="Console access"
      action={
        onMarkLeft ? (
          <Button variant="link" className="text-sm text-danger" onClick={onMarkLeft}>
            Mark as left
          </Button>
        ) : undefined
      }
    >
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Detail label="Role">{access.roleLabel}</Detail>
        <Detail label="Opens">
          <ul className="flex flex-col gap-0.5">
            {access.groups.map((group) => (
              <li key={group.label}>
                <span className="text-muted">{group.label}: </span>
                {group.sections.map((section) => (section.note ? `${section.label} (${section.note})` : section.label)).join(", ")}
              </li>
            ))}
          </ul>
        </Detail>
        <Detail label="Last login">{where && access.lastLoginAt ? `${lastLogin}, ${where}` : lastLogin}</Detail>
        <Detail label="Login">{access.loginOn ? "On" : "Off: they can no longer log in"}</Detail>
      </dl>
      <HowItWorks label="What each section is for">
        <ul className="flex flex-col gap-0.5">
          {access.groups.flatMap((group) => group.sections).map((section) => (
            <li key={section.label}>
              <span className="font-semibold text-foreground">{section.label}</span>: {section.about}
            </li>
          ))}
        </ul>
        <p>What a person opens follows from their role, the same for everyone in it; change the role under Details to change it. Mark as left switches the login off and ends every session at once.</p>
      </HowItWorks>
    </Panel>
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
