import { describe, expect, it } from "vitest";
import {
  aiFindings,
  aiResultOf,
  aiUsageQuerySchema,
  aiUsageRange,
  aiWarnings,
  creditLeft,
  dayCount,
  hourRange,
  lastsWords,
  median,
  monthForecast,
  quietWeekday,
  shareOfPay,
  type AiWarningFacts,
} from "./ai-usage.js";

describe("the page's filters", () => {
  it("read lists from the address, and refuse what they do not know", () => {
    const query = aiUsageQuerySchema.parse({ outlet: "a,b", feature: ["photo-check", "buddy"], result: "limit" });
    expect(query).toMatchObject({ period: "month", outlet: ["a", "b"], feature: ["photo-check", "buddy"], result: ["limit"], org: [] });
    expect(aiUsageQuerySchema.safeParse({ feature: "no-such-helper" }).success).toBe(false);
    expect(aiUsageQuerySchema.safeParse({ period: "year" }).success).toBe(false);
  });

  it("turn a period into India dates", () => {
    const today = "2026-10-19";
    expect(aiUsageRange({ period: "month" }, today)).toEqual({ from: "2026-10-01", to: "2026-10-19" });
    expect(aiUsageRange({ period: "today" }, today)).toEqual({ from: today, to: today });
    expect(aiUsageRange({ period: "7d" }, today)).toEqual({ from: "2026-10-13", to: today });
    expect(aiUsageRange({ period: "lastMonth" }, today)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(aiUsageRange({ period: "lastMonth" }, "2026-01-05")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    // Custom dates in either order, never past today, at most a year.
    expect(aiUsageRange({ period: "custom", from: "2026-10-18", to: "2026-10-02" }, today)).toEqual({ from: "2026-10-02", to: "2026-10-18" });
    expect(aiUsageRange({ period: "custom", from: "2026-10-10", to: "2026-12-31" }, today)).toEqual({ from: "2026-10-10", to: today });
    expect(dayCount(...Object.values(aiUsageRange({ period: "custom", from: "2020-01-01", to: today }, today)) as [string, string])).toBe(366);
    expect(aiUsageRange({ period: "custom" }, today)).toEqual({ from: "2026-10-01", to: today });
  });

  it("name results and hours", () => {
    expect(aiResultOf("LIMIT")).toBe("limit");
    expect(aiResultOf("INVALID")).toBe("invalid");
    expect(hourRange(7)).toBe("7 to 8 am");
    expect(hourRange(11)).toBe("11 am to 12 pm");
    expect(hourRange(13)).toBe("1 to 2 pm");
    expect(hourRange(23)).toBe("11 pm to 12 am");
    expect(hourRange(0)).toBe("12 to 1 am");
  });
});

describe("the cards' sums", () => {
  it("forecast the month at its pace", () => {
    // US$19 in the first 19 days of a 31-day month is US$31 by its end.
    expect(monthForecast(19, "2026-10-19")).toEqual({ forecastUsd: 31, daysGone: 19, daysInMonth: 31 });
    expect(monthForecast(0, "2026-02-01").daysInMonth).toBe(28);
  });

  it("work out \"of what they pay\": the AI's cost over the outlet's invoices before GST", () => {
    // US$4.79 at ₹84 is ₹402.36; against ₹6,000 invoiced that is 6.7%.
    expect(shareOfPay(4.79, 84, 600_000)).toBe(6.7);
    expect(shareOfPay(1, 84, 0)).toBeNull();
  });

  it("say what is left of the credit and how long it lasts", () => {
    expect(creditLeft(100, 50.25, 2)).toEqual({ leftUsd: 49.75, fraction: 0.4975, lastsDays: 24.875 });
    expect(creditLeft(100, 120, 2)).toMatchObject({ leftUsd: 0, fraction: 0 });
    expect(creditLeft(100, 10, 0).lastsDays).toBeNull();
    expect(lastsWords(null)).toBe("nothing is being spent");
    expect(lastsWords(5.4)).toBe("about 5 more days");
    expect(lastsWords(24.875)).toBe("about 4 more weeks");
    expect(lastsWords(40)).toBe("about 6 more weeks");
    expect(lastsWords(100)).toBe("about 3 more months");
  });

  it("find a quiet weekday only when it is clearly quiet, over two weeks", () => {
    const days = Array.from({ length: 14 }, (_, index) => {
      const date = `2026-10-${String(index + 1).padStart(2, "0")}`;
      // 4 and 11 October 2026 are Sundays.
      return { date, usd: date === "2026-10-04" || date === "2026-10-11" ? 0.05 : 2 };
    });
    expect(quietWeekday(days)).toEqual({ weekday: "Sunday", usd: 0.05 });
    expect(quietWeekday(days.map((day) => ({ ...day, usd: 2 })))).toBeNull();
    expect(quietWeekday(days.slice(0, 7))).toBeNull();
  });

  it("take the middle value", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("the plain findings", () => {
  const base = { rate: 84, helpers: [], limitDays: [], busiestHour: null, nearCap: [], forecast: null };

  it("say which helper is most of the bill, and why", () => {
    expect(aiFindings({ ...base, helpers: [{ feature: "photo-check", costUsd: 23.36, share: 48 }, { feature: "buddy", costUsd: 5, share: 10 }] })).toEqual([
      "Camera nudge is 48% of the spend (₹1,962) because it runs on every checklist proof photo.",
    ]);
    // A helper that is not much of the bill is not called out.
    expect(aiFindings({ ...base, helpers: [{ feature: "buddy", costUsd: 1, share: 20 }] })).toEqual([]);
  });

  it("put the most pressing first and keep to three", () => {
    const found = aiFindings({
      ...base,
      helpers: [{ feature: "buddy", costUsd: 10, share: 60 }],
      limitDays: ["2026-10-18", "2026-10-23"],
      busiestHour: { hour: 7, requests: 120 },
      nearCap: [{ name: "Spice Route, Gachibowli", percent: 85 }],
      forecast: { forecastUsd: 70, monthlyLimitUsd: 60 },
    });
    expect(found).toEqual([
      "At this pace the month ends near ₹5,880 (US$70.00), over the US$60.00 monthly limit: requests will be refused before the month is out.",
      "The limit for everything was reached on 2 days (18 Oct, 23 Oct): some requests were refused until the next day.",
      "Spice Route, Gachibowli has used 85% of its daily cap today.",
    ]);
    expect(aiFindings({ ...base, busiestHour: { hour: 7, requests: 120 } })).toEqual(["Busiest hour: 7 to 8 am, with 120 requests."]);
  });
});

describe("the warnings at the top", () => {
  const calm: AiWarningFacts = {
    rate: 84,
    serverOn: true,
    keySet: true,
    consoleOn: true,
    todayUsd: 0.5,
    dailyLimitUsd: 2,
    dayPercent: 80,
    monthUsd: 10,
    monthlyLimitUsd: null,
    monthPercent: 80,
    creditLeftUsd: 60,
    creditUnderUsd: 20,
    today: [],
  };

  it("are quiet when nothing is wrong", () => {
    expect(aiWarnings(calm)).toEqual([]);
  });

  it("say when AI is off on the server or in the console, past a warning share, low on credit, or failing", () => {
    const kinds = aiWarnings({
      ...calm,
      serverOn: false,
      consoleOn: false,
      todayUsd: 1.7,
      monthUsd: 50,
      monthlyLimitUsd: 60,
      creditLeftUsd: 12,
      today: [
        { feature: "photo-check", tries: 20, failed: 3 },
        { feature: "buddy", tries: 2, failed: 2 },
      ],
    }).map((warning) => warning.kind);
    // Buddy failed 2 of 2, too few tries to count.
    expect(kinds).toEqual(["SERVER_OFF", "CONSOLE_OFF", "DAY", "MONTH", "CREDIT", "FAILING"]);
    expect(aiWarnings({ ...calm, todayUsd: 2 })[0]!.text).toBe("Today has used 100% of the US$2.00 daily limit (₹168). Requests are refused until midnight.");
    expect(aiWarnings({ ...calm, keySet: false })[0]!.kind).toBe("NO_KEY");
    // A failure rate of exactly 10% is not more than 10%.
    expect(aiWarnings({ ...calm, today: [{ feature: "photo-check", tries: 10, failed: 1 }] })).toEqual([]);
  });
});
