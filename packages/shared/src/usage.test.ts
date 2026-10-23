import { describe, expect, it } from "vitest";
import {
  isUsageScreen,
  lastActiveWords,
  restaurantState,
  usageDayOf,
  usageOverview,
  usageRowsFrom,
  usageScreenFromPath,
  usageScreenFromSegments,
  usageScreenInfo,
  usageViewsSchema,
  type UsagePersonFacts,
  type UsageRestaurantFacts,
  type UsageRowFacts,
} from "./usage.js";

const TODAY = "2026-10-23";
const SPICE = "11111111-1111-4111-8111-111111111111";
const DECCAN = "22222222-2222-4222-8222-222222222222";

const row = (day: string, userId: string, screen: string, more: Partial<UsageRowFacts> = {}): UsageRowFacts => ({
  day,
  userId,
  role: "OWNER",
  organizationId: SPICE,
  app: "APP",
  screen,
  views: 1,
  ...more,
});

describe("screens", () => {
  it("names a phone screen by its route, without groups, index or ids", () => {
    expect(usageScreenFromSegments(["(app)"])).toBe("/");
    expect(usageScreenFromSegments(["(app)", "team", "[staffId]"])).toBe("/team/[staffId]");
    expect(usageScreenFromSegments(["(app)", "checklists", "index"])).toBe("/checklists");
    expect(usageScreenFromSegments(["(app)", "checklists", "0cfdedfd-6008-4db0-a522-57b27cd06574"])).toBe("/checklists/[id]");
  });

  it("names a console page by its pattern, keeping only its tab", () => {
    expect(usageScreenFromPath("/team/3f2a9c1e-1111-4111-8111-111111111111", { id: "3f2a9c1e-1111-4111-8111-111111111111" })).toBe("/team/[id]");
    expect(usageScreenFromPath("/clients", {}, "health")).toBe("/clients?tab=health");
    expect(usageScreenFromPath("/", {})).toBe("/");
    // A record's id is never kept, even when the page did not name it as a parameter.
    expect(usageScreenFromPath("/quality/incidents/9b1d2c3e-1111-4111-8111-111111111111", {})).toBe("/quality/incidents/[id]");
    expect(usageScreenFromPath("/logs", {}, "Not A Tab!")).toBe("/logs");
  });

  it("accepts only screen names, never addresses with searches or ids in words", () => {
    expect(isUsageScreen("/team/[staffId]")).toBe(true);
    expect(isUsageScreen("/clients?tab=health")).toBe(true);
    expect(isUsageScreen("/vendors?search=ramesh")).toBe(false);
    expect(isUsageScreen("https://example.com/")).toBe(false);
    expect(isUsageScreen(`/${"a".repeat(130)}`)).toBe(false);
  });

  it("puts each screen in its part of the app, with a name in words", () => {
    expect(usageScreenInfo("APP", "/team/attendance")).toEqual({ area: "staff", label: "Attendance" });
    expect(usageScreenInfo("APP", "/")).toEqual({ area: "home", label: "Home" });
    expect(usageScreenInfo("APP", "/plan")).toEqual({ area: "billing", label: "Plan" });
    expect(usageScreenInfo("CONSOLE", "/team/[id]")).toEqual({ area: "team", label: "A team member" });
    expect(usageScreenInfo("CONSOLE", "/clients?tab=new-outlets")).toEqual({ area: "clients", label: "Clients: new outlets" });
    expect(usageScreenInfo("APP", "/something-new")).toEqual({ area: "other", label: "/something-new" });
  });

  it("takes at most 50 opens at a time", () => {
    const one = { screen: "/", at: "2026-10-23T04:00:00.000Z" };
    expect(usageViewsSchema.safeParse({ app: "APP", views: [one] }).success).toBe(true);
    expect(usageViewsSchema.safeParse({ app: "APP", views: Array.from({ length: 51 }, () => one) }).success).toBe(false);
    expect(usageViewsSchema.safeParse({ app: "APP", views: [] }).success).toBe(false);
  });

  it("counts an open on its own day, unless the phone's clock is ahead or the note came very late", () => {
    const now = new Date("2026-10-23T10:00:00.000Z");
    expect(usageDayOf("2026-10-23T08:00:00.000Z", now).toISOString()).toBe("2026-10-23T08:00:00.000Z");
    expect(usageDayOf("2026-10-24T08:00:00.000Z", now)).toBe(now);
    expect(usageDayOf("2026-10-20T08:00:00.000Z", now)).toBe(now);
  });
});

describe("restaurantState", () => {
  it("says which restaurants need a look", () => {
    expect(restaurantState({ lastActiveOn: null, recentDays: 0, priorDays: 0, today: TODAY })).toMatchObject({ state: "NEVER", words: "Not used yet" });
    expect(restaurantState({ lastActiveOn: "2026-10-14", recentDays: 3, priorDays: 10, today: TODAY })).toMatchObject({ state: "QUIET", words: "No use for 9 days" });
    expect(restaurantState({ lastActiveOn: "2026-10-22", recentDays: 6, priorDays: 10, today: TODAY })).toMatchObject({ state: "DOWN", words: "Used less: 40% fewer days", change: -40 });
    expect(restaurantState({ lastActiveOn: "2026-10-22", recentDays: 8, priorDays: 10, today: TODAY })).toMatchObject({ state: "OK", words: null, change: -20 });
    expect(restaurantState({ lastActiveOn: "2026-10-23", recentDays: 5, priorDays: 0, today: TODAY })).toMatchObject({ state: "NEW", change: null });
  });
});

describe("usageOverview", () => {
  const people: UsagePersonFacts[] = [
    { id: "owner", name: "Ravi", role: "OWNER", organizationId: SPICE, lastActiveOn: TODAY },
    { id: "manager", name: "Asha", role: "MANAGER", organizationId: SPICE, lastActiveOn: "2026-10-21" },
    { id: "chef", name: "Imran", role: "HEAD_CHEF", organizationId: SPICE, lastActiveOn: null },
    { id: "deccan", name: "Kiran", role: "OWNER", organizationId: DECCAN, lastActiveOn: "2026-10-01" },
    { id: "admin", name: "Founder", role: "SUPER_ADMIN", organizationId: null, lastActiveOn: TODAY },
  ];
  const restaurants: UsageRestaurantFacts[] = [
    { id: SPICE, name: "Spice Route", lastActiveOn: TODAY },
    { id: DECCAN, name: "Deccan Biryani", lastActiveOn: "2026-10-01" },
  ];
  const rows: UsageRowFacts[] = [
    row(TODAY, "owner", "/checklists", { views: 3 }),
    row(TODAY, "owner", "/"),
    row("2026-10-22", "owner", "/checklists/[runId]", { views: 2 }),
    row("2026-10-21", "manager", "/team/attendance"),
    row("2026-10-01", "deccan", "/", { organizationId: DECCAN }),
    row(TODAY, "admin", "/usage", { role: "SUPER_ADMIN", organizationId: null, app: "CONSOLE" }),
  ];
  const base = { rows, people, restaurants, today: TODAY, days: 30 as const, segment: "restaurants" as const, restaurantId: null };

  it("counts active people today, this week and this month, out of the logins", () => {
    const { tiles } = usageOverview(base);
    expect(tiles).toMatchObject({ activeToday: 1, active7: 2, active30: 3, logins: 4, restaurantsActive7: 1, restaurantsTotal: 2 });
    // Daily people over 30 days: 1 + 1 + 1 + (one more on the 1st) = 4; ÷ 30 ÷ 3 people ≈ 4%.
    expect(tiles.stickiness).toBe(4);
  });

  it("puts the restaurant gone quiet first, with what it used most", () => {
    const { restaurants: list } = usageOverview(base);
    expect(list.map((r) => [r.name, r.state, r.stateWords])).toEqual([
      ["Deccan Biryani", "QUIET", "No use for 22 days"],
      ["Spice Route", "NEW", "New this month"],
    ]);
    expect(list[1]).toMatchObject({ logins: 3, active7: 2, daysActive30: 3, views: 7, topArea: "Daily checklists" });
  });

  it("lists the parts used and the top screens", () => {
    const view = usageOverview(base);
    expect(view.areas[0]).toMatchObject({ area: "home", restaurants: 2, people: 2 });
    expect(view.areas.find((a) => a.area === "checklists")).toMatchObject({ people: 1, restaurants: 1, views: 5 });
    expect(view.screens[0]).toMatchObject({ screen: "/checklists", label: "Daily checklists", views: 3 });
    expect(view.restaurantsActive).toBe(2);
  });

  it("lists every login, the ones never used last", () => {
    const names = usageOverview(base).people.map((p) => [p.name, p.daysActive, p.views]);
    expect(names).toEqual([
      ["Ravi", 2, 6],
      ["Asha", 1, 1],
      ["Kiran", 1, 1],
      ["Imran", 0, 0],
    ]);
  });

  it("draws one point a day across the period", () => {
    const { daily } = usageOverview({ ...base, days: 7 });
    expect(daily).toHaveLength(7);
    expect(daily.at(-1)).toEqual({ date: TODAY, people: 1, views: 4 });
    expect(daily.at(-2)).toEqual({ date: "2026-10-22", people: 1, views: 2 });
  });

  it("narrows everything to one restaurant", () => {
    const view = usageOverview({ ...base, restaurantId: DECCAN });
    expect(view.tiles).toMatchObject({ activeToday: 0, active30: 1, logins: 1, restaurantsTotal: 1 });
    expect(view.restaurants.map((r) => r.name)).toEqual(["Deccan Biryani"]);
    expect(view.people.map((p) => p.name)).toEqual(["Kiran"]);
  });

  it("counts ECCS's own team apart, with no restaurants", () => {
    const view = usageOverview({ ...base, segment: "team" });
    expect(view.tiles).toMatchObject({ activeToday: 1, logins: 1, restaurantsActive7: null, restaurantsTotal: null });
    expect(view.restaurants).toEqual([]);
    expect(view.people.map((p) => [p.name, p.apps])).toEqual([["Founder", ["CONSOLE"]]]);
    expect(view.areas.map((a) => a.label)).toEqual(["Usage"]);
  });

  it("asks for enough days to compare 28 days with the 28 before", () => {
    expect(usageRowsFrom(TODAY, 7)).toBe("2026-08-29");
    expect(usageRowsFrom(TODAY, 90)).toBe("2026-07-26");
  });
});

describe("lastActiveWords", () => {
  it("says when, in words", () => {
    expect(lastActiveWords(null, TODAY)).toBe("Never");
    expect(lastActiveWords(TODAY, TODAY)).toBe("Today");
    expect(lastActiveWords("2026-10-22", TODAY)).toBe("Yesterday");
    expect(lastActiveWords("2026-10-19", TODAY)).toBe("4 days ago");
    expect(lastActiveWords("2026-10-12", TODAY)).toBe("12 Oct");
  });
});
