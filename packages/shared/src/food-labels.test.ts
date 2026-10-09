import { describe, expect, it } from "vitest";
import {
  ALLERGENS,
  checkLabelTimes,
  closeFoodLabelSchema,
  createFoodItemSchema,
  createFoodLabelSchema,
  DAY_MARKS,
  FOOD_LABEL_RULES,
  formatLabelMoment,
  formatLabelWeekday,
  groupLabels,
  indiaDay,
  indiaWeekday,
  labelGroup,
  LABELS_PER_SHEET,
  labelsHtml,
  searchStarterItems,
  shelfLifeParts,
  STARTER_FOOD_ITEMS,
  STORAGE_TYPES,
  toShelfLifeHours,
  useByFor,
  type LabelPrintData,
} from "./food-labels.js";

// India is UTC+5:30, so 18:30 UTC is midnight in India.
const india = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);

describe("shelf life", () => {
  it("is stored in hours", () => {
    expect(toShelfLifeHours(3, "DAYS")).toBe(72);
    expect(toShelfLifeHours(36, "HOURS")).toBe(36);
  });

  it("is shown in whole days from two days up, otherwise in hours", () => {
    expect(shelfLifeParts(72)).toEqual({ value: 3, unit: "DAYS" });
    expect(shelfLifeParts(48)).toEqual({ value: 2, unit: "DAYS" });
    expect(shelfLifeParts(24)).toEqual({ value: 24, unit: "HOURS" });
    expect(shelfLifeParts(36)).toEqual({ value: 36, unit: "HOURS" });
    expect(shelfLifeParts(720)).toEqual({ value: 30, unit: "DAYS" });
  });
});

describe("useByFor", () => {
  it("adds the shelf life to the moment the food was prepared", () => {
    expect(useByFor(india("2026-10-09", "16:30"), 24)).toEqual(india("2026-10-10", "16:30"));
    expect(useByFor(india("2026-10-09", "16:30"), 72)).toEqual(india("2026-10-12", "16:30"));
    expect(useByFor("2026-10-09T11:00:00.000Z", 4).toISOString()).toBe("2026-10-09T15:00:00.000Z");
  });

  it("crosses the end of a month, a year and a leap day", () => {
    expect(useByFor(india("2026-10-30", "22:00"), 72)).toEqual(india("2026-11-02", "22:00"));
    expect(useByFor(india("2026-12-31", "09:00"), 48)).toEqual(india("2027-01-02", "09:00"));
    expect(useByFor(india("2028-02-28", "09:00"), 48)).toEqual(india("2028-03-01", "09:00"));
  });
});

describe("checkLabelTimes", () => {
  const now = india("2026-10-09", "16:30");
  const check = (overrides: Partial<Parameters<typeof checkLabelTimes>[0]> = {}) =>
    checkLabelTimes({
      preparedAt: now,
      expiresAt: useByFor(now, 48),
      shelfLifeHours: 48,
      now,
      mayOverride: false,
      ...overrides,
    });

  it("accepts prepared now with the full shelf life", () => {
    expect(check()).toEqual({ problem: null, overridden: false });
  });

  it("accepts a use-by sooner than the shelf life allows", () => {
    expect(check({ expiresAt: useByFor(now, 6) })).toEqual({ problem: null, overridden: false });
  });

  it("refuses a prepared time in the future, beyond a few minutes of clock difference", () => {
    expect(check({ preparedAt: new Date(now.getTime() + 4 * 60_000), expiresAt: useByFor(now, 24) }).problem).toBeNull();
    expect(check({ preparedAt: new Date(now.getTime() + 6 * 60_000), expiresAt: useByFor(now, 24) }).problem).toBe(
      "PREPARED_IN_FUTURE",
    );
  });

  it("lets prepared go back a day and no further", () => {
    const back = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
    expect(check({ preparedAt: back(24), expiresAt: useByFor(back(24), 48) }).problem).toBeNull();
    expect(check({ preparedAt: back(25), expiresAt: useByFor(back(25), 48) }).problem).toBe("PREPARED_TOO_OLD");
    expect(FOOD_LABEL_RULES.maxBackdateHours).toBe(24);
  });

  it("measures use-by from the prepared time, not from now", () => {
    const earlier = new Date(now.getTime() - 10 * 3_600_000);
    // Prepared ten hours ago: 48 hours from now would be 58 hours of life.
    expect(check({ preparedAt: earlier, expiresAt: useByFor(now, 48) }).problem).toBe("OVERRIDE_NOT_ALLOWED");
    expect(check({ preparedAt: earlier, expiresAt: useByFor(earlier, 48) }).problem).toBeNull();
  });

  it("refuses a use-by at or before the prepared time", () => {
    expect(check({ expiresAt: now }).problem).toBe("USE_BY_BEFORE_PREPARED");
    expect(check({ expiresAt: new Date(now.getTime() - 60_000) }).problem).toBe("USE_BY_BEFORE_PREPARED");
  });

  it("gives a minute's leeway before calling a use-by an override", () => {
    expect(check({ expiresAt: new Date(useByFor(now, 48).getTime() + 60_000) })).toEqual({ problem: null, overridden: false });
    expect(check({ expiresAt: new Date(useByFor(now, 48).getTime() + 61_000) }).overridden).toBe(true);
  });

  it("lets only a Manager or Owner go past the shelf life, and only with a reason", () => {
    const longer = useByFor(now, 72);
    expect(check({ expiresAt: longer })).toEqual({ problem: "OVERRIDE_NOT_ALLOWED", overridden: true });
    expect(check({ expiresAt: longer, overrideReason: "Vacuum packed" }).problem).toBe("OVERRIDE_NOT_ALLOWED");
    expect(check({ expiresAt: longer, mayOverride: true }).problem).toBe("OVERRIDE_NEEDS_REASON");
    expect(check({ expiresAt: longer, mayOverride: true, overrideReason: "   " }).problem).toBe("OVERRIDE_NEEDS_REASON");
    expect(check({ expiresAt: longer, mayOverride: true, overrideReason: "Vacuum packed" })).toEqual({
      problem: null,
      overridden: true,
    });
  });

  it("never allows more than about a year, even with an override", () => {
    const tooFar = new Date(now.getTime() + (FOOD_LABEL_RULES.maxUseByDays + 1) * 86_400_000);
    expect(check({ expiresAt: tooFar, mayOverride: true, overrideReason: "Pickle" }).problem).toBe("USE_BY_TOO_FAR");
  });
});

describe("days in India", () => {
  it("changes the day at midnight in India, not at midnight UTC", () => {
    expect(indiaDay("2026-10-09T18:29:59.000Z")).toBe("2026-10-09");
    expect(indiaDay("2026-10-09T18:30:00.000Z")).toBe("2026-10-10");
    expect(indiaDay(india("2026-10-10", "00:00"))).toBe("2026-10-10");
    expect(indiaDay(india("2026-12-31", "23:59"))).toBe("2026-12-31");
  });

  it("knows the day of the week in India", () => {
    // 9 October 2026 is a Friday.
    expect(indiaWeekday(india("2026-10-09", "12:00"))).toBe(5);
    // 11:30 pm on Friday in India is still Friday, though it is already Friday evening UTC; and
    // half past midnight on Saturday in India is Saturday, though UTC still says Friday.
    expect(indiaWeekday(india("2026-10-09", "23:30"))).toBe(5);
    expect(indiaWeekday(india("2026-10-10", "00:30"))).toBe(6);
    expect(indiaWeekday(india("2026-10-11", "08:00"))).toBe(0);
  });

  it("gives every day of the week its own shape and colour", () => {
    expect(DAY_MARKS).toHaveLength(7);
    expect(new Set(DAY_MARKS.map((mark) => mark.shape)).size).toBe(7);
    expect(new Set(DAY_MARKS.map((mark) => mark.color)).size).toBe(7);
  });
});

describe("labelGroup", () => {
  const now = india("2026-10-09", "16:30");

  it("is EXPIRED from the use-by moment on", () => {
    expect(labelGroup(india("2026-10-09", "16:29"), now)).toBe("EXPIRED");
    expect(labelGroup(now, now)).toBe("EXPIRED");
    expect(labelGroup(india("2026-10-08", "23:00"), now)).toBe("EXPIRED");
  });

  it("is TODAY when it runs out later the same day in India", () => {
    expect(labelGroup(india("2026-10-09", "16:31"), now)).toBe("TODAY");
    expect(labelGroup(india("2026-10-09", "23:59"), now)).toBe("TODAY");
  });

  it("is LATER from midnight in India onwards", () => {
    expect(labelGroup(india("2026-10-10", "00:00"), now)).toBe("LATER");
    expect(labelGroup(india("2026-10-10", "00:30"), now)).toBe("LATER");
    expect(labelGroup(india("2026-10-12", "16:30"), now)).toBe("LATER");
  });

  it("follows the Indian day late at night, when UTC is still on the day before", () => {
    // 1 am on the 10th in India is 7:30 pm on the 9th in UTC.
    const lateNight = india("2026-10-10", "01:00");
    expect(labelGroup(india("2026-10-10", "09:00"), lateNight)).toBe("TODAY");
    expect(labelGroup(india("2026-10-11", "00:30"), lateNight)).toBe("LATER");
    // And 11 pm on the 9th in India: something due at 00:30 belongs to tomorrow.
    expect(labelGroup(india("2026-10-10", "00:30"), india("2026-10-09", "23:00"))).toBe("LATER");
  });

  it("moves a label from LATER to TODAY to EXPIRED as time passes", () => {
    const expiresAt = india("2026-10-10", "14:00");
    expect(labelGroup(expiresAt, india("2026-10-09", "23:59"))).toBe("LATER");
    expect(labelGroup(expiresAt, india("2026-10-10", "00:00"))).toBe("TODAY");
    expect(labelGroup(expiresAt, india("2026-10-10", "13:59"))).toBe("TODAY");
    expect(labelGroup(expiresAt, india("2026-10-10", "14:00"))).toBe("EXPIRED");
  });
});

describe("groupLabels", () => {
  it("splits labels into the three groups, soonest use-by first in each", () => {
    const now = india("2026-10-09", "16:30");
    const label = (id: string, date: string, time: string) => ({ id, expiresAt: india(date, time).toISOString() });
    const groups = groupLabels(
      [
        label("later-2", "2026-10-12", "10:00"),
        label("today-2", "2026-10-09", "22:00"),
        label("expired-2", "2026-10-09", "09:00"),
        label("later-1", "2026-10-10", "00:00"),
        label("today-1", "2026-10-09", "18:00"),
        label("expired-1", "2026-10-07", "09:00"),
      ],
      now,
    );
    expect(groups.EXPIRED.map((entry) => entry.id)).toEqual(["expired-1", "expired-2"]);
    expect(groups.TODAY.map((entry) => entry.id)).toEqual(["today-1", "today-2"]);
    expect(groups.LATER.map((entry) => entry.id)).toEqual(["later-1", "later-2"]);
  });
});

describe("words on the label", () => {
  it("writes the day name, the date, the month as a word and the time, in India", () => {
    const text = formatLabelMoment("2026-10-09T11:00:00.000Z", "EN");
    expect(text).toContain("Fri");
    expect(text).toContain("9");
    expect(text).toContain("Oct");
    expect(text).toMatch(/4:30/);
    expect(formatLabelWeekday("2026-10-09T11:00:00.000Z", "EN")).toBe("Friday");
    // Half past midnight on Saturday in India, while UTC is still on Friday.
    expect(formatLabelWeekday("2026-10-09T19:00:00.000Z", "EN")).toBe("Saturday");
  });

  it("keeps ordinary digits in every language", () => {
    for (const language of ["HI", "TE", "BN", "MR", "UR"] as const) {
      expect(formatLabelMoment("2026-10-09T11:00:00.000Z", language)).toMatch(/9/);
    }
  });
});

describe("the printed label", () => {
  const label: LabelPrintData = {
    itemName: "అల్లం-వెల్లుల్లి పేస్ట్ <b>&",
    preparedHeading: "Prepared",
    preparedText: "Fri, 9 Oct, 4:30 pm",
    useByHeading: "Use by",
    useByText: "Mon, 12 Oct, 4:30 pm",
    dayWord: "Monday",
    dayIndex: 1,
    lines: ["By Ravi", "Chilled", "Allergens: Milk"],
    outletName: "Test Kitchen",
    rtl: false,
  };

  it("carries every part of the label and escapes what the kitchen typed", () => {
    const html = labelsHtml([label], "L50X30");
    expect(html).toContain("అల్లం-వెల్లుల్లి పేస్ట్ &lt;b&gt;&amp;");
    expect(html).not.toContain("<b>&");
    for (const part of ["Prepared", "Fri, 9 Oct, 4:30 pm", "Use by", "Mon, 12 Oct, 4:30 pm", "Monday", "By Ravi", "Allergens: Milk", "Test Kitchen"]) {
      expect(html).toContain(part);
    }
    expect(html).toContain("size: 50mm 30mm");
    // The day's shape is drawn, not left to colour.
    expect(html).toContain("<circle");
  });

  it("prints one label to a page on a label printer, and 24 to a page on A4", () => {
    const three = labelsHtml([label, label, label], "L50X25");
    expect(three.match(/class="label"/g)).toHaveLength(3);
    expect(three).toContain("size: 50mm 25mm");

    expect(LABELS_PER_SHEET).toBe(24);
    const sheet = labelsHtml(Array.from({ length: 30 }, () => label), "A4");
    expect(sheet).toContain("size: A4");
    expect(sheet.match(/class="sheet"/g)).toHaveLength(2);
    expect(sheet.match(/class="label"/g)).toHaveLength(30);
  });

  it("reads right to left in Urdu", () => {
    expect(labelsHtml([{ ...label, rtl: true }], "L50X30")).toContain('dir="rtl"');
    expect(labelsHtml([label], "L50X30")).not.toContain('dir="rtl"');
  });
});

describe("requests", () => {
  it("checks a food item's name, storage and shelf life", () => {
    const item = { outletId: "o", name: "Raita", storage: "CHILLED", shelfLifeHours: 24 };
    expect(createFoodItemSchema.safeParse(item).success).toBe(true);
    expect(createFoodItemSchema.safeParse({ ...item, name: " " }).success).toBe(false);
    expect(createFoodItemSchema.safeParse({ ...item, storage: "WARM" }).success).toBe(false);
    expect(createFoodItemSchema.safeParse({ ...item, shelfLifeHours: 0 }).success).toBe(false);
    expect(createFoodItemSchema.safeParse({ ...item, shelfLifeHours: 1.5 }).success).toBe(false);
    expect(createFoodItemSchema.safeParse({ ...item, shelfLifeHours: FOOD_LABEL_RULES.maxShelfLifeHours + 1 }).success).toBe(false);
    expect(createFoodItemSchema.safeParse({ ...item, allergens: ["PEANUTS"] }).success).toBe(false);
  });

  it("puts allergens in the standard order without repeats", () => {
    const parsed = createFoodItemSchema.parse({
      outletId: "o",
      name: "Raita",
      storage: "CHILLED",
      shelfLifeHours: 24,
      allergens: ["SESAME", "MILK", "MILK"],
    });
    expect(parsed.allergens).toEqual(["MILK", "SESAME"]);
  });

  it("limits the number of copies of a label", () => {
    expect(createFoodLabelSchema.parse({ foodItemId: "i" }).copies).toBe(1);
    expect(createFoodLabelSchema.safeParse({ foodItemId: "i", copies: 0 }).success).toBe(false);
    expect(createFoodLabelSchema.safeParse({ foodItemId: "i", copies: FOOD_LABEL_RULES.maxCopies }).success).toBe(true);
    expect(createFoodLabelSchema.safeParse({ foodItemId: "i", copies: FOOD_LABEL_RULES.maxCopies + 1 }).success).toBe(false);
    expect(createFoodLabelSchema.safeParse({ foodItemId: "i", preparedAt: "yesterday" }).success).toBe(false);
  });

  it("needs a reason to throw food away, and none to mark it used up", () => {
    expect(closeFoodLabelSchema.safeParse({ outcome: "USED" }).success).toBe(true);
    expect(closeFoodLabelSchema.safeParse({ outcome: "DISCARDED" }).success).toBe(false);
    expect(closeFoodLabelSchema.safeParse({ outcome: "DISCARDED", reason: "SPOILED" }).success).toBe(true);
    expect(closeFoodLabelSchema.safeParse({ outcome: "DISCARDED", reason: "LOST" }).success).toBe(false);
  });
});

describe("the starter list", () => {
  it("is a modest list of valid items with unique keys", () => {
    expect(STARTER_FOOD_ITEMS.length).toBeGreaterThanOrEqual(30);
    expect(STARTER_FOOD_ITEMS.length).toBeLessThanOrEqual(50);
    expect(new Set(STARTER_FOOD_ITEMS.map((item) => item.key)).size).toBe(STARTER_FOOD_ITEMS.length);
    for (const item of STARTER_FOOD_ITEMS) {
      expect(STORAGE_TYPES).toContain(item.storage);
      expect(item.shelfLifeHours).toBeGreaterThanOrEqual(FOOD_LABEL_RULES.minShelfLifeHours);
      expect(item.shelfLifeHours).toBeLessThanOrEqual(FOOD_LABEL_RULES.maxShelfLifeHours);
      for (const allergen of item.allergens) expect(ALLERGENS).toContain(allergen);
    }
  });

  it("suggests nothing chilled for longer than a week", () => {
    for (const item of STARTER_FOOD_ITEMS.filter((entry) => entry.storage === "CHILLED")) {
      expect(item.shelfLifeHours).toBeLessThanOrEqual(7 * 24);
    }
  });

  it("is searched by every word typed", () => {
    expect(searchStarterItems("").length).toBe(STARTER_FOOD_ITEMS.length);
    expect(searchStarterItems("chicken marinated").map((item) => item.key)).toEqual(["marinated-chicken"]);
    expect(searchStarterItems("zzz")).toEqual([]);
  });
});
