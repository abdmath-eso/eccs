import { describe, expect, it } from "vitest";
import {
  inspectionShownUntil,
  isLocalOnlyAddress,
  pickRecentServices,
  PUBLIC_PAGE_RULES,
  publicInspectionState,
  publicPageState,
  publicPageUrl,
  selfCheckSummary,
  selfCheckWindow,
} from "./public-page.js";

const TODAY = "2026-10-09";

describe("inspection validity", () => {
  it("shows an inspection for 180 days, the last day counted", () => {
    expect(PUBLIC_PAGE_RULES.inspectionValidDays).toBe(180);
    expect(inspectionShownUntil("2026-04-12")).toBe("2026-10-09");
    expect(publicInspectionState("2026-04-12", TODAY)).toBe("CURRENT");
    expect(publicInspectionState("2026-04-11", TODAY)).toBe("EXPIRED");
    expect(publicInspectionState(TODAY, TODAY)).toBe("CURRENT");
  });

  it("has nothing to show without an inspection, or for one dated in the future", () => {
    expect(publicInspectionState(null, TODAY)).toBe("NONE");
    expect(publicInspectionState("2026-10-10", TODAY)).toBe("EXPIRED");
  });
});

describe("publicPageState", () => {
  const live = { clientActive: true, takenDown: false, enabled: true, inspectionDate: "2026-09-01", today: TODAY };

  it("is live only when everything holds", () => {
    expect(publicPageState(live)).toBe("LIVE");
  });

  it("lapses by itself when the inspection is too old or missing", () => {
    expect(publicPageState({ ...live, inspectionDate: "2026-04-11" })).toBe("INSPECTION_EXPIRED");
    expect(publicPageState({ ...live, inspectionDate: null })).toBe("NO_INSPECTION");
  });

  it("is off when the restaurant switched it off or ECCS took it down", () => {
    expect(publicPageState({ ...live, enabled: false })).toBe("OFF");
    expect(publicPageState({ ...live, takenDown: true })).toBe("TAKEN_DOWN");
  });

  it("reports ECCS's take-down ahead of the restaurant's switch, and a client that left ahead of both", () => {
    // The restaurant's switch being on does not bring a taken-down page back.
    expect(publicPageState({ ...live, takenDown: true, enabled: true })).toBe("TAKEN_DOWN");
    expect(publicPageState({ ...live, takenDown: true, enabled: false })).toBe("TAKEN_DOWN");
    expect(publicPageState({ ...live, clientActive: false, takenDown: true })).toBe("INACTIVE");
    expect(publicPageState({ ...live, clientActive: false })).toBe("INACTIVE");
  });
});

describe("selfCheckSummary", () => {
  it("counts the 30 days ending yesterday", () => {
    expect(selfCheckWindow(TODAY)).toEqual({ from: "2026-09-09", to: "2026-10-08" });
  });

  it("counts a day only when every checklist due that day was handed in", () => {
    const summary = selfCheckSummary(
      [
        { date: "2026-10-08", handedIn: true },
        { date: "2026-10-08", handedIn: true },
        { date: "2026-10-07", handedIn: true },
        { date: "2026-10-07", handedIn: false },
        { date: "2026-10-06", handedIn: false },
      ],
      TODAY,
    );
    expect(summary).toEqual({ handedIn: 1, days: 3 });
  });

  it("leaves out today, days before the window and days with nothing due", () => {
    const summary = selfCheckSummary(
      [
        { date: TODAY, handedIn: true },
        { date: "2026-09-08", handedIn: true },
        { date: "2026-09-09", handedIn: true },
      ],
      TODAY,
    );
    expect(summary).toEqual({ handedIn: 1, days: 1 });
  });

  it("is null when there is nothing to count", () => {
    expect(selfCheckSummary([], TODAY)).toBeNull();
    expect(selfCheckSummary([{ date: TODAY, handedIn: true }], TODAY)).toBeNull();
  });
});

describe("pickRecentServices", () => {
  it("keeps the latest of each kind, newest first", () => {
    const picked = pickRecentServices(
      [
        { code: "PEST", date: "2026-09-01" },
        { code: "PEST", date: "2026-09-20" },
        { code: "DEEP_CLEAN", date: "2026-10-01" },
        { code: "CHIMNEY", date: "2026-08-15" },
      ],
      TODAY,
    );
    expect(picked).toEqual([
      { code: "DEEP_CLEAN", date: "2026-10-01" },
      { code: "PEST", date: "2026-09-20" },
      { code: "CHIMNEY", date: "2026-08-15" },
    ]);
  });

  it("drops services older than a year or dated in the future, and lists at most six", () => {
    expect(pickRecentServices([{ code: "PEST", date: "2025-10-08" }, { code: "HOOD", date: "2026-10-10" }], TODAY)).toEqual([]);
    expect(pickRecentServices([{ code: "PEST", date: "2025-10-09" }], TODAY)).toHaveLength(1);
    const many = Array.from({ length: 9 }, (_, index) => ({ code: `K${index}`, date: `2026-09-0${index + 1}` }));
    const picked = pickRecentServices(many, TODAY);
    expect(picked).toHaveLength(PUBLIC_PAGE_RULES.maxServices);
    expect(picked[0]).toEqual({ code: "K8", date: "2026-09-09" });
  });
});

describe("the page's address", () => {
  it("is the base address, /k/ and the token", () => {
    expect(publicPageUrl("https://eccs.example.in", "abc")).toBe("https://eccs.example.in/k/abc");
    expect(publicPageUrl("https://eccs.example.in/", "abc")).toBe("https://eccs.example.in/k/abc");
  });

  it("knows an address that only works inside the office", () => {
    for (const address of [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://192.168.1.40:3000",
      "http://10.0.0.5",
      "http://172.16.4.2",
      "http://172.31.255.1",
      "http://169.254.1.1",
      "http://office-pc:3000",
      "http://eccs.local",
      "http://[::1]:3000",
      "not an address",
    ]) {
      expect(isLocalOnlyAddress(address), address).toBe(true);
    }
    for (const address of ["https://eccs.example.in", "https://clean.eccs.co.in/", "http://172.32.0.1", "http://8.8.8.8", "http://192.169.1.1"]) {
      expect(isLocalOnlyAddress(address), address).toBe(false);
    }
  });
});
