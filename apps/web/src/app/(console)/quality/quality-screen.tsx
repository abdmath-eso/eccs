"use client";

import { can, QUALITY_RULES, type QualitySummaryDto, type QualityTileDto } from "@eccs/shared";
import { useCallback, useEffect, useState } from "react";

import { useToast } from "@/components/toast";
import { Button, LoadError, NoAccess, PageHeader, PageTabs } from "@/components/ui";
import { api } from "@/lib/api";
import { describe } from "@/lib/format";
import { useNavCounts } from "@/lib/nav-counts";
import { useQuery } from "@/lib/query";
import { useSession } from "@/lib/session";

import { Sheet } from "../finance/finance-parts";
import { FollowUpsTab } from "./follow-ups";
import { IncidentForm } from "./incident-form";
import { IncidentsTab } from "./incidents";
import { PhotosTab } from "./photos-queue";

// Pattern followed: three work queues filled by rules, each item leaving when its work is done, as in
// field-service callback tracking (ServiceTitan's recalls), moderation queues (Shopify review apps,
// Reddit's modqueue) and incident logs (SafetyCulture); the month strip is the field-service
// "callback rate" idea in ECCS's own measures. The founder's design (20 Oct 2026, page 5) is the
// layout; docs/CONSOLE_PLAN.md 4.5. Tabs in the address, as Visits, Sales and Clients do.

const TABS = ["follow-ups", "photos", "incidents"] as const;
type Tab = (typeof TABS)[number];

/**
 * Quality (console plan step 3, 20 Oct 2026), for the Super Admin and the Ops Manager: the
 * headline, three tabs (`tab=`: Follow-ups, the first; Photos; Incidents), each with its count,
 * and the month strip at the foot under every tab. "Add an incident" is the page's one action.
 */
export default function QualityScreen() {
  const { user } = useSession();
  const allowed = user ? can(user.memberships, "quality", "read") : false;
  if (!allowed) {
    return <NoAccess title="Quality">Follow-ups, photos to judge and incidents are for Super Admins and Operations Managers.</NoAccess>;
  }
  return <Quality />;
}

function Quality() {
  const { user } = useSession();
  const query = useQuery();
  const notify = useToast();
  const { refresh: refreshCounts } = useNavCounts();
  const asked = query.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(asked) ? (asked as Tab) : "follow-ups";
  const mayAdd = user ? can(user.memberships, "quality", "create") : false;

  const [summary, setSummary] = useState<QualitySummaryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [adding, setAdding] = useState(false);
  // Goes up when an incident is added here, so the Incidents tab loads again.
  const [incidentsVersion, setIncidentsVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.quality
      .summary()
      .then((next) => {
        if (cancelled) return;
        setSummary(next);
        setError(null);
      })
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  /** After any action in a tab: the headline, the tab counts and the menu's badge are brought up to date. */
  const changed = useCallback(() => {
    setAttempt((value) => value + 1);
    refreshCounts();
  }, [refreshCounts]);

  const counts = summary?.counts ?? null;
  const tabs = (
    <PageTabs
      label="Parts of Quality"
      tabs={[
        { href: "/quality?tab=follow-ups", label: "Follow-ups", current: tab === "follow-ups", count: counts?.followUps, countLabel: "with nothing booked" },
        {
          href: "/quality?tab=photos",
          label: "Photos",
          current: tab === "photos",
          count: counts ? counts.photos + counts.customerPhotos : null,
          countLabel: "waiting to be judged or approved",
        },
        { href: "/quality?tab=incidents", label: "Incidents", current: tab === "incidents", count: counts?.incidents, countLabel: "open" },
      ]}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          summary ? (
            <>
              <span className="sr-only">Quality: </span>
              {summary.headline}
            </>
          ) : (
            "Quality"
          )
        }
        description="Kitchens to call back, photos to judge, and incidents: each comes in when a rule trips and leaves when its work is done."
        action={mayAdd && <Button onClick={() => setAdding(true)}>Add an incident</Button>}
        how={
          <>
            <p>
              <strong>Follow-ups.</strong> A kitchen comes in by itself when a visit is rated {QUALITY_RULES.lowRatingStars} stars or fewer, an issue
              is reopened, its hygiene score falls {QUALITY_RULES.scoreDropPoints} points or more in a week, or an inspection ends with no grade (any
              failed critical check gives none). Each cause comes in once, from the last {QUALITY_RULES.causeLookbackDays} days. Log a call, book a
              free visit (a normal visit in the diary with no invoice and no new score), or close it with a note. It leaves when its free visit is
              done or it is closed. Nothing here changes a score: there is no re-inspection.
            </p>
            <p>
              <strong>Photos.</strong> A photo is doubtful when it is the same as one used before, was taken far from the kitchen or with a faked
              location, carries a time that cannot be right, or belongs to a checklist ticked too fast to be real. Accept clears it. Reject asks
              for a retake: for a restaurant&apos;s checklist the outlet&apos;s Manager is told, for an ECCS visit the Supervisor, with the reason you
              choose. Rejections count on the Health board under Photos. Photos older than {QUALITY_RULES.photoLookbackDays} days are no longer
              asked about. The photos proposed for customer pages are approved here too.
            </p>
            <p>
              <strong>Incidents.</strong> Anything that could become a claim, a complaint or a lesson: an injury, damage, a missing item. Each has
              its own page with its photos and files, and a PDF for an insurer or a lawyer; there is no public link. Open incidents show on Today
              until they are closed.
            </p>
          </>
        }
      />

      {tabs}
      {!summary && error && <LoadError message={error} onRetry={() => setAttempt((value) => value + 1)} />}

      {tab === "follow-ups" && <FollowUpsTab onChanged={changed} />}
      {tab === "photos" && <PhotosTab counts={counts} approvesCustomerPhotos={summary?.approvesCustomerPhotos ?? false} onChanged={changed} />}
      {tab === "incidents" && <IncidentsTab openCount={counts?.incidents ?? null} version={incidentsVersion} />}

      {summary && <MonthStrip tiles={summary.strip} />}

      <Sheet open={adding} title="Add an incident" onClose={() => setAdding(false)}>
        <IncidentForm
          onCancel={() => setAdding(false)}
          onSaved={(incident) => {
            setAdding(false);
            notify(`Incident ${incident.reference} added`, { detail: incident.outletName, href: `/quality/incidents/${encodeURIComponent(incident.id)}` });
            setIncidentsVersion((value) => value + 1);
            if (tab !== "incidents") query.set({ tab: "incidents", state: null, followUp: null, queue: null, show: null });
            changed();
          }}
        />
      </Sheet>
    </div>
  );
}

/** The month at a glance, one line at the foot of the page: four figures, two by two on a phone. */
function MonthStrip({ tiles }: { tiles: readonly QualityTileDto[] }) {
  return (
    <dl aria-label="This month" className="grid grid-cols-2 gap-x-4 gap-y-4 rounded-xl border border-border bg-surface p-4 lg:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.key} className="flex min-w-0 flex-col">
          <dt className="text-sm text-muted">{tile.label}</dt>
          <dd className="text-xl font-bold sm:text-2xl">{tile.value}</dd>
          <dd className="text-sm text-muted">{tile.detail}</dd>
        </div>
      ))}
    </dl>
  );
}
