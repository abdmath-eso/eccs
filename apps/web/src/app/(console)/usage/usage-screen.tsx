"use client";

import {
  can,
  lastActiveWords,
  USAGE_APP_LABELS,
  USAGE_PERIODS,
  type UsageDayDto,
  type UsageOverviewDto,
  type UsagePeriod,
  type UsagePersonDto,
  type UsageRestaurantDto,
  type UsageSegment,
} from "@eccs/shared";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { Button, LoadError, Loading, NoAccess, PageHeader, PageTabs, SelectField } from "@/components/ui";
import { api } from "@/lib/api";
import { describe } from "@/lib/format";
import { useQuery } from "@/lib/query";
import { useSession } from "@/lib/session";

import { COLOR, dayMonth, Panel, Segmented } from "../finance/finance-parts";
import { Pill, plural, ShareBar, whole, type Tone } from "../ai-usage/ai-usage-parts";

// The Usage page (23 Oct 2026): Console > Business > Usage, for the Super Admin. Who uses the
// restaurant app, the Supervisor's app and the console, how often, and which parts, from the
// counts each app sends of the screens a logged-in person opens (packages/shared/src/usage.ts).
//
// PATTERN FOLLOWED: the usage pages of established products, one page with the main figures
// first. Pendo's account overview (active today, in 7 days and in 30 days) and its feature use by
// account; Mixpanel's company profile (daily, weekly and monthly active users, activity per user);
// Google Workspace's apps usage report (each person's last activity); the stickiness ratio, daily
// active ÷ monthly active (Pendo, Gainsight); Metabase's feature-adoption guide (accounts using it
// less: the last 28 days against the 28 before, shown first); Plausible's top pages, counted
// without cookies or trackers. Like the Logs and AI usage pages, the choices live in the web
// address, the explanation is folded away, and wide tables become lists on a phone.

const KEY = { tab: "tab", days: "days", restaurant: "restaurant" } as const;

export default function UsageScreen() {
  const { user } = useSession();
  const allowed = user ? can(user.memberships, "usage", "read") : false;
  if (!allowed) return <NoAccess title="Usage">The Usage page is for the Super Admin.</NoAccess>;
  return <Usage />;
}

function Usage() {
  const query = useQuery();
  const params = useSearchParams();
  const segment: UsageSegment = params.get(KEY.tab) === "team" ? "team" : "restaurants";
  const days: UsagePeriod = USAGE_PERIODS.find((period) => String(period) === params.get(KEY.days)) ?? 30;
  const restaurant = segment === "restaurants" ? params.get(KEY.restaurant) || null : null;
  const key = `${segment}|${days}|${restaurant ?? ""}`;

  const [loaded, setLoaded] = useState<{ key: string; data: UsageOverviewDto } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    api.usage
      .overview({ days, segment, restaurant })
      .then((data) => current && setLoaded({ key, data }))
      .catch((caught) => current && setError({ key, message: describe(caught) }));
    return () => {
      current = false;
    };
  }, [key, days, segment, restaurant, attempt]);

  const data = loaded?.data ?? null;
  const failed = error?.key === key && loaded?.key !== key ? error.message : null;

  const tabs = [
    { href: query.hrefWith({ [KEY.tab]: null, [KEY.restaurant]: null }), label: "Restaurants", current: segment === "restaurants" },
    { href: query.hrefWith({ [KEY.tab]: "team", [KEY.restaurant]: null }), label: "ECCS team", current: segment === "team" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Usage"
        description="Who uses the apps and the console, how often, and which parts."
        how={
          <>
            <p>
              Each app notes the screens a logged-in person opens and sends the notes every half minute. The server keeps, for each person and day, how many times
              they opened each screen: nothing about what was on it. Nobody is counted while nobody is logged in, so restaurant staff who only clock in are never
              counted. The counts are kept for {data?.keepDays ?? 365} days.
            </p>
            <p>
              &quot;Active&quot; means the person opened at least one screen that day. &quot;Daily ÷ monthly&quot; is the average number active on a day out of
              everyone active in the last 30 days: the higher, the more it is part of their day. A restaurant needs a look when nobody has used the app for 7 days,
              when it was used on 30% fewer days in the last 4 weeks than in the 4 before, or when it has never been used.
            </p>
            <p>Phones count only once they have the app version with this feature (an APK built after 23 October 2026). The Logs page records what people change.</p>
          </>
        }
      />

      <PageTabs label="Whose use" tabs={tabs} />

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <Segmented
          label="Period"
          value={String(days)}
          options={USAGE_PERIODS.map((period) => ({ value: String(period), label: `${period} days` }))}
          onChange={(value) => query.set({ [KEY.days]: value === "30" ? null : value }, "replace")}
        />
        {segment === "restaurants" && data && (
          <SelectField
            label="Restaurant"
            wrapperClassName="w-full max-w-xs"
            value={restaurant ?? ""}
            onChange={(event) => query.set({ [KEY.restaurant]: event.target.value || null })}
          >
            <option value="">All restaurants</option>
            {data.restaurantChoices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.name}
              </option>
            ))}
          </SelectField>
        )}
      </div>

      {failed ? (
        <LoadError message={`The usage figures could not be loaded. ${failed}`} onRetry={() => setAttempt((n) => n + 1)} />
      ) : !data ? (
        <Loading />
      ) : (
        <div className={`flex flex-col gap-6 ${loaded?.key !== key ? "opacity-60" : ""}`}>
          <Tiles data={data} />
          <DailyPanel days={data.daily} />
          {segment === "restaurants" && (
            <RestaurantsPanel data={data} restaurantHref={(id) => query.hrefWith({ [KEY.restaurant]: id })} onAll={() => query.set({ [KEY.restaurant]: null })} />
          )}
          <div className="grid gap-6 lg:grid-cols-2">
            <AreasPanel data={data} />
            <ScreensPanel data={data} />
          </div>
          <PeoplePanel data={data} />
        </div>
      )}
    </div>
  );
}

// ───────────────────────── The cards ─────────────────────────

function Card({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface p-3 sm:p-4">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-xl font-bold tracking-tight whitespace-nowrap tabular-nums sm:text-2xl">{value}</span>
      <span className="text-xs text-muted">{children}</span>
    </div>
  );
}

function Tiles({ data }: { data: UsageOverviewDto }) {
  const { tiles } = data;
  const who = data.segment === "team" ? "team member" : "login";
  const of = `of ${plural(tiles.logins, who)}`;
  return (
    <div className={`grid grid-cols-2 gap-3 md:grid-cols-3 ${tiles.restaurantsTotal !== null ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}>
      <Card label="Active today" value={whole(tiles.activeToday)}>
        {of}
      </Card>
      <Card label="Active this week" value={whole(tiles.active7)}>
        {of}, last 7 days
      </Card>
      <Card label="Active this month" value={whole(tiles.active30)}>
        {of}, last 30 days
      </Card>
      {tiles.restaurantsTotal !== null && tiles.restaurantsActive7 !== null && (
        <Card label="Restaurants this week" value={whole(tiles.restaurantsActive7)}>
          of {plural(tiles.restaurantsTotal, "restaurant")} used the app in the last 7 days
        </Card>
      )}
      <Card label="Daily ÷ monthly" value={tiles.stickiness === null ? "—" : `${tiles.stickiness}%`}>
        {tiles.stickiness === null ? "nobody active in the last 30 days" : "of this month's people are active on an average day"}
      </Card>
    </div>
  );
}

// ───────────────────────── Day by day ─────────────────────────

/** People active each day: one bar a day on one scale from nothing, the figures on hover and in a hidden table. */
function DailyPanel({ days }: { days: readonly UsageDayDto[] }) {
  const max = Math.max(0, ...days.map((day) => day.people));
  // Whole people only: steps of 1, 2, 3… up to four steps above the busiest day.
  const step = Math.max(1, Math.ceil(max / 4));
  const top = step * 4;
  const ticks = [0, 1, 2, 3, 4].map((n) => n * step);
  // Every fifth day named over a month, every week over three: room for them on a phone too.
  const every = days.length > 31 ? 7 : days.length > 16 ? 5 : 1;
  const title = `People active each day, ${dayMonth(days[0]!.date)} to ${dayMonth(days.at(-1)!.date)}`;
  return (
    <Panel title={title} description="Each bar is the number of people who opened anything that day. Hover over a bar for its screens opened.">
      <figure className="flex flex-col gap-1">
        <div className="relative ml-8" style={{ height: 170 }} aria-hidden>
          {ticks.map((tick) => (
            <div key={tick} className="absolute inset-x-0 border-t border-border" style={{ bottom: `${(tick / top) * 100}%` }}>
              <span className="absolute -left-8 w-7 -translate-y-1/2 text-right text-xs text-muted tabular-nums">{tick}</span>
            </div>
          ))}
          <div className="absolute inset-0 flex items-end">
            {days.map((day) => (
              <div key={day.date} title={`${dayMonth(day.date)}: ${plural(day.people, "person", "people")}, ${plural(day.views, "screen")} opened`} className="flex h-full min-w-0 flex-1 items-end justify-center px-[2px]">
                <div className="w-full max-w-7 rounded-t-[4px]" style={{ height: day.people > 0 ? `max(2px, ${(day.people / top) * 100}%)` : 0, background: COLOR.in }} />
              </div>
            ))}
          </div>
        </div>
        <div className="ml-8 flex" aria-hidden>
          {days.map((day, index) => (
            <div key={day.date} className="min-w-0 flex-1 text-center text-xs text-muted tabular-nums">
              {index % every === 0 || index === days.length - 1 ? Number(day.date.slice(8)) : ""}
            </div>
          ))}
        </div>
        <div className="sr-only">
          <table>
            <caption>{title}</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">People</th>
                <th scope="col">Screens opened</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.date}>
                  <th scope="row">{dayMonth(day.date)}</th>
                  <td>{day.people}</td>
                  <td>{day.views}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </figure>
    </Panel>
  );
}

// ───────────────────────── Restaurants ─────────────────────────

const STATE_TONE: Record<UsageRestaurantDto["state"], Tone> = { QUIET: "bad", DOWN: "warn", NEVER: "plain", NEW: "good", OK: "good" };

function stateWords(row: UsageRestaurantDto) {
  return row.stateWords ?? (row.change !== null && row.change > 0 ? `Up ${row.change}%` : "Fine");
}

function RestaurantsPanel({ data, restaurantHref, onAll }: { data: UsageOverviewDto; restaurantHref: (id: string) => string; onAll: () => void }) {
  const rows = data.restaurants;
  const needLook = rows.filter((row) => row.state === "QUIET" || row.state === "DOWN" || row.state === "NEVER").length;
  const name = (row: UsageRestaurantDto) =>
    data.restaurant ? (
      <span className="font-medium">{row.name}</span>
    ) : (
      <Link href={restaurantHref(row.id)} className="font-medium text-primary hover:underline">
        {row.name}
      </Link>
    );
  return (
    <Panel
      title="Restaurants"
      description={needLook > 0 ? `${plural(needLook, "restaurant")} to look at first, then the busiest. Choose one to see only its figures.` : "Busiest first. Choose one to see only its figures."}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No restaurants yet.</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <thead className="text-muted">
                <tr className="border-b border-border">
                  <th scope="col" className="py-2 pr-3 font-medium whitespace-nowrap">Restaurant</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium whitespace-nowrap">Logins used this week</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium whitespace-nowrap">Days used, last 30</th>
                  <th scope="col" className="py-2 pr-3 font-medium whitespace-nowrap">Last used</th>
                  <th scope="col" className="py-2 pr-3 font-medium whitespace-nowrap">Used most</th>
                  <th scope="col" className="py-2 font-medium whitespace-nowrap">Against the 4 weeks before</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border align-top">
                    <td className="py-2 pr-3">{name(row)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {row.active7} of {row.logins}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{row.daysActive30}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{lastActiveWords(row.lastActiveOn, data.today)}</td>
                    <td className="py-2 pr-3">{row.topArea ?? "—"}</td>
                    <td className="py-2">
                      <Pill tone={STATE_TONE[row.state]}>{stateWords(row)}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col divide-y divide-border text-sm md:hidden">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-1 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  {name(row)}
                  <Pill tone={STATE_TONE[row.state]}>{stateWords(row)}</Pill>
                </div>
                <p className="text-muted">
                  {row.active7} of {plural(row.logins, "login")} this week · {plural(row.daysActive30, "day")} of the last 30 · last used {lastActiveWords(row.lastActiveOn, data.today).toLowerCase()}
                </p>
                {row.topArea && <p className="text-muted">Used most: {row.topArea}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
      {data.restaurant && (
        <Button variant="link" className="w-fit text-sm" onClick={onAll}>
          Show all restaurants
        </Button>
      )}
    </Panel>
  );
}

// ───────────────────────── Parts and screens ─────────────────────────

function AreasPanel({ data }: { data: UsageOverviewDto }) {
  const restaurants = data.segment === "restaurants" && !data.restaurant;
  const people = Math.max(1, ...data.areas.map((area) => area.people));
  return (
    <Panel
      title="Parts of the apps"
      description={
        !restaurants
          ? "How many people used each part in the period."
          : data.restaurantsActive === 1
            ? "Which parts the one restaurant active in the period used."
            : `How many of the ${data.restaurantsActive} restaurants active in the period used each part.`
      }
    >
      {data.areas.length === 0 ? (
        <p className="text-sm text-muted">Nothing was opened in the period.</p>
      ) : (
        <ul className="flex flex-col gap-3 text-sm">
          {data.areas.map((area) => (
            <li key={area.area} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{area.label}</span>
                <span className="text-right whitespace-nowrap text-muted tabular-nums">
                  {restaurants ? `${area.restaurants} of ${data.restaurantsActive} · ` : ""}
                  {plural(area.people, "person", "people")} · {plural(area.views, "open")}
                </span>
              </div>
              <ShareBar fraction={restaurants ? area.restaurants / Math.max(1, data.restaurantsActive) : area.people / people} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ScreensPanel({ data }: { data: UsageOverviewDto }) {
  const [all, setAll] = useState(false);
  const shown = all ? data.screens : data.screens.slice(0, 10);
  return (
    <Panel
      title="Top screens"
      description="The screens opened most in the period."
      action={
        data.screens.length > 10 ? (
          <Button variant="link" className="text-sm" onClick={() => setAll((open) => !open)}>
            {all ? "Show fewer" : `Show all ${data.screens.length}`}
          </Button>
        ) : undefined
      }
    >
      {shown.length === 0 ? (
        <p className="text-sm text-muted">Nothing was opened in the period.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-border text-sm">
          {shown.map((screen) => (
            <li key={`${screen.app} ${screen.screen}`} className="flex items-baseline justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block font-medium">{screen.label}</span>
                <span className="block text-xs text-muted">
                  {screen.areaLabel} · {USAGE_APP_LABELS[screen.app]}
                </span>
              </span>
              <span className="text-right whitespace-nowrap tabular-nums">
                {whole(screen.views)}
                <span className="block text-xs text-muted">{plural(screen.people, "person", "people")}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

// ───────────────────────── People ─────────────────────────

function PeoplePanel({ data }: { data: UsageOverviewDto }) {
  const [all, setAll] = useState(false);
  const team = data.segment === "team";
  const shown = all ? data.people : data.people.slice(0, 15);
  const never = data.people.filter((person) => person.lastActiveOn === null).length;
  const where = (person: UsagePersonDto) => (team ? person.apps.map((app) => USAGE_APP_LABELS[app]).join(", ") || "—" : (person.organizationName ?? "—"));
  return (
    <Panel
      title={team ? "Team members" : "Logins"}
      description={`Most recent first.${never > 0 ? ` ${plural(never, team ? "team member has" : "login has", team ? "team members have" : "logins have")} never been used.` : ""}`}
      action={
        data.people.length > 15 ? (
          <Button variant="link" className="text-sm" onClick={() => setAll((open) => !open)}>
            {all ? "Show fewer" : `Show all ${data.people.length}`}
          </Button>
        ) : undefined
      }
    >
      {shown.length === 0 ? (
        <p className="text-sm text-muted">No {team ? "team members" : "logins"} yet.</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="text-muted">
                <tr className="border-b border-border">
                  <th scope="col" className="py-2 pr-3 font-medium whitespace-nowrap">Person</th>
                  <th scope="col" className="py-2 pr-3 font-medium whitespace-nowrap">Role</th>
                  <th scope="col" className="py-2 pr-3 font-medium whitespace-nowrap">{team ? "Used" : "Restaurant"}</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium whitespace-nowrap">Days used</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium whitespace-nowrap">Screens opened</th>
                  <th scope="col" className="py-2 font-medium whitespace-nowrap">Last used</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((person) => (
                  <tr key={person.id} className="border-b border-border align-top">
                    <td className="py-2 pr-3 font-medium">{person.name}</td>
                    <td className="py-2 pr-3">{person.roleLabel}</td>
                    <td className="py-2 pr-3">{where(person)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{person.daysActive}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{whole(person.views)}</td>
                    <td className={`py-2 whitespace-nowrap ${person.lastActiveOn === null ? "text-muted" : ""}`}>{lastActiveWords(person.lastActiveOn, data.today)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col divide-y divide-border text-sm md:hidden">
            {shown.map((person) => (
              <li key={person.id} className="flex flex-col gap-0.5 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium">{person.name}</span>
                  <span className={`whitespace-nowrap ${person.lastActiveOn === null ? "text-muted" : ""}`}>{lastActiveWords(person.lastActiveOn, data.today)}</span>
                </div>
                <p className="text-muted">
                  {person.roleLabel} · {where(person)} · {plural(person.daysActive, "day")}, {plural(person.views, "screen")}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-xs text-muted">Days used and screens opened are for the period chosen above; last used is from everything kept.</p>
    </Panel>
  );
}
