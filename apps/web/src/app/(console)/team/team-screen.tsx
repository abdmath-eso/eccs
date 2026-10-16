"use client";

import { can, TEAM_ROLE_LABELS, type TeamListDto, type TeamRowDto } from "@eccs/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { useToast } from "@/components/toast";
import { Button, EmptyState, HowItWorks, LoadError, Loading, NoAccess, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { describe, today } from "@/lib/format";
import { useNavCounts } from "@/lib/nav-counts";
import { useQuery } from "@/lib/query";
import { useSession } from "@/lib/session";

import { COLOR, money, SampleBadge, Segmented } from "../finance/finance-parts";
import { Initials, MemberSheet } from "./team-parts";

// The Team page (16 Oct 2026): ECCS's own staff (the Ops Manager, the Supervisors and the
// BDEs), not a restaurant's cooks. One row a person: who they are, whether they are in today
// and since when, this week's main figure against its target, and the one thing to keep an
// eye on. A row opens the person's page.
//
// PATTERN FOLLOWED: LeadSquared's "My Teams" view for field-sales managers (one card a
// person with today's check-in status and time, filters by status and team, a person opening
// their own page) and the team tables of Pipedrive Insights and HubSpot's rep productivity
// report (a few figures per rep against their goal). The main list first; how presence and
// salaries are worked out folded under "How this works".

type Filter = "all" | "OPS_MANAGER" | "SUPERVISOR" | "BDE" | "joining" | "left";

/** Joining: a joining day still ahead, or an onboarding still open (16 Oct 2026). */
const isJoining = (row: TeamRowDto) => Boolean(row.onboarding) || Boolean(row.joinedOn && row.joinedOn > today());

export default function TeamScreen() {
  const { user } = useSession();
  const allowed = user ? can(user.memberships, "team", "read") : false;
  if (!allowed) return <NoAccess title="Team">The Team page is for the founders and the Ops Manager.</NoAccess>;
  return <Team />;
}

function Team() {
  const { user } = useSession();
  const query = useQuery();
  const router = useRouter();
  const { refresh: refreshCounts } = useNavCounts();
  const [data, setData] = useState<TeamListDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [adding, setAdding] = useState(false);
  const memberships = user?.memberships ?? [];
  const manages = can(memberships, "eccsUsers", "create");
  const seesPay = can(memberships, "team", "approve");
  const asked = query.get("show");
  const filter = (["OPS_MANAGER", "SUPERVISOR", "BDE", "joining", "left"].includes(asked) ? asked : "all") as Filter;

  useEffect(() => {
    let cancelled = false;
    api.eccsTeam
      .list()
      .then((list) => {
        if (cancelled) return;
        setData(list);
        setError(null);
      })
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const header = (
    <PageHeader
      title="Team"
      description="Who is in today, each person's week, and what to keep an eye on."
      action={manages ? <Button onClick={() => setAdding(true)}>Add a team member</Button> : undefined}
      secondary={
        seesPay ? (
          <Link href="/team/onboarding" className="rounded-lg border border-border-strong bg-surface px-4 py-2.5 font-semibold hover:bg-background">
            Onboarding checklist
          </Link>
        ) : undefined
      }
    />
  );
  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        {error ? <LoadError message={error} onRetry={() => setAttempt((value) => value + 1)} /> : <Loading />}
      </div>
    );
  }

  const current = data.members.filter((row) => !row.leftOn);
  const left = data.members.filter((row) => row.leftOn);
  const joining = current.filter(isJoining);
  const count = (role: Filter) => (role === "left" ? left.length : role === "joining" ? joining.length : current.filter((row) => row.role === role).length);
  const options = (
    [
      { value: "all", label: `All (${current.length})` },
      { value: "OPS_MANAGER", label: "Ops Manager" },
      { value: "SUPERVISOR", label: "Supervisors" },
      { value: "BDE", label: "BDEs" },
      { value: "joining", label: `Joining (${joining.length})` },
      { value: "left", label: "Left" },
    ] as const
  ).filter((option) => option.value === "all" || count(option.value) > 0);
  const shown = filter === "all" ? current : filter === "left" ? left : filter === "joining" ? joining : current.filter((row) => row.role === filter);
  const inToday = current.filter((row) => row.today.state === "IN").length;

  return (
    <div className="flex flex-col gap-6">
      {header}
      <div className="-mt-3 flex flex-wrap items-center gap-3 text-sm text-muted">
        {data.sample && <SampleBadge />}
        <span>
          {inToday} of {current.length} in today · {data.flagged} to keep an eye on
        </span>
      </div>

      {options.length > 2 && (
        <Segmented label="Show" showLabel={false} value={filter} onChange={(value) => query.set({ show: value === "all" ? null : value }, "replace")} options={options} />
      )}

      {shown.length === 0 ? (
        <EmptyState title="Nobody here yet" action={manages ? <Button onClick={() => setAdding(true)}>Add a team member</Button> : undefined}>
          Add the Ops Manager, the Supervisors and the BDEs, with the mobile number each logs in with.
        </EmptyState>
      ) : (
        <TeamTable rows={shown} seesPay={seesPay} />
      )}

      <HowItWorks>
        <p>
          Nobody marks attendance. Whether someone is in is read from what they did: a BDE&apos;s first lead step of the day (by the time it was done on the phone, so a day
          worked without signal counts on the right day), a Supervisor&apos;s first visit arrival or inspection, and the Ops Manager&apos;s first change in the console. Leave is
          recorded on each person&apos;s page and is never a day missed.
        </p>
        <p>
          A BDE&apos;s figures are the Sales page&apos;s own. Follow-ups on time is the share of next steps that fell due this week with a step logged on the lead by then; arrivals
          on time, the share of visits a Supervisor reached by the end of the arrival window. Both are held against one target.
        </p>
        <p>Each person&apos;s monthly salary, from their joining day to their last, becomes the Salaries line on the Finance page, owed until it is marked paid there.</p>
        <p>
          Joining: someone whose joining day is still ahead, or whose onboarding checklist is not done yet. Onboarding tasks past their day are the last thing that
          puts someone under &ldquo;keep an eye on&rdquo;.
        </p>
        {seesPay && <TargetForm target={data.onTimeTargetPercent} onSaved={() => setAttempt((value) => value + 1)} />}
      </HowItWorks>

      <MemberSheet
        open={adding}
        member={null}
        seesPay={seesPay}
        onClose={() => setAdding(false)}
        onSaved={(member) => {
          refreshCounts();
          router.push(`/team/${member.userId}`);
        }}
      />
    </div>
  );
}

/** "In since 9:40 am" with a dot, the words carrying the meaning; under it, "Onboarding 9 of 16" while it is open. */
function Today({ row }: { row: TeamRowDto }) {
  const color = row.today.state === "IN" ? COLOR.in : row.today.state === "LEAVE" ? "#9DB0C9" : "#C9CDD3";
  return (
    <span className="inline-flex flex-col">
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        {row.today.words}
      </span>
      {row.onboarding && <span className="pl-3.5 text-xs whitespace-nowrap text-muted">{row.onboarding.words}</span>}
    </span>
  );
}

function Flag({ row }: { row: TeamRowDto }) {
  if (!row.memberId && !row.leftOn) return <span className="text-muted">No team details yet</span>;
  if (!row.flag) return <span className="text-muted">—</span>;
  return (
    <span className="inline-flex items-start gap-1.5 font-medium" style={{ color: "#8A5300" }}>
      <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: "#B26A00" }} />
      {row.flag.words}
    </span>
  );
}

const weekWords = (row: TeamRowDto) => (row.week ? `${row.week.done} of ${row.week.target} ${row.week.label}` : "—");

function TeamTable({ rows, seesPay }: { rows: readonly TeamRowDto[]; seesPay: boolean }) {
  const name = (row: TeamRowDto) => (
    <Link href={`/team/${row.userId}`} className="flex items-center gap-3">
      <Initials text={row.initials} />
      <span className="min-w-0">
        <span className="block font-semibold text-primary hover:underline">{row.name}</span>
        <span className="block text-muted">{[TEAM_ROLE_LABELS[row.role], row.area].filter(Boolean).join(" · ")}</span>
      </span>
    </Link>
  );
  return (
    <>
      {/* A narrow screen gets one card a person. */}
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface px-4 text-sm md:hidden">
        {rows.map((row) => (
          <li key={row.userId} className="flex flex-col gap-2 py-3">
            {name(row)}
            <div className="flex flex-wrap gap-x-4 gap-y-1 pl-12">
              <Today row={row} />
              {row.week && <span className="tabular-nums">{weekWords(row)}</span>}
              {seesPay && row.monthlyPaise !== null && <span className="tabular-nums text-muted">{money(row.monthlyPaise)} a month</span>}
            </div>
            {(row.flag || !row.memberId) && (
              <div className="pl-12">
                <Flag row={row} />
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-surface md:block">
        <table className="w-full text-left text-sm">
          <thead className="text-muted">
            <tr className="border-b border-border">
              <th scope="col" className="px-4 py-2.5 font-medium">Person</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Today</th>
              <th scope="col" className="px-3 py-2.5 font-medium">This week</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Keep an eye on</th>
              {seesPay && <th scope="col" className="px-4 py-2.5 text-right font-medium">Salary</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.userId} className="border-b border-border align-top last:border-0">
                <td className="px-4 py-3">{name(row)}</td>
                <td className="px-3 py-3 pt-4">
                  <Today row={row} />
                </td>
                <td className="px-3 py-3 pt-4 whitespace-nowrap tabular-nums">{weekWords(row)}</td>
                <td className="max-w-[22rem] px-3 py-3 pt-4">
                  <Flag row={row} />
                </td>
                {seesPay && <td className="px-4 py-3 pt-4 text-right whitespace-nowrap tabular-nums">{row.monthlyPaise !== null ? money(row.monthlyPaise) : "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** The share of follow-ups and arrivals on time aimed for (the Super Admin). */
function TargetForm({ target, onSaved }: { target: number; onSaved: () => void }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(new FormData(event.currentTarget).get("target"));
    if (!Number.isInteger(value) || value < 1 || value > 100) return setError("Enter a whole percent from 1 to 100");
    setBusy(true);
    setError(null);
    try {
      await api.eccsTeam.saveSettings({ onTimeTargetPercent: value });
      notify("On-time target saved");
      onSaved();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(event) => void save(event)} className="flex flex-wrap items-end gap-2 text-foreground">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">On-time target, %</span>
        <input name="target" inputMode="numeric" defaultValue={String(target)} className="w-20 rounded-lg border border-border-strong bg-surface px-2 py-1.5 text-right tabular-nums" />
      </label>
      <Button type="submit" size="sm" variant="secondary" loading={busy}>
        Save
      </Button>
      {error && <span className="text-sm font-semibold text-danger">{error}</span>}
    </form>
  );
}
