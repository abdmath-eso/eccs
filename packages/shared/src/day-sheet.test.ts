import { describe, expect, it } from "vitest";
import { carryItemsSchema, cleanCarryList, daySheetKey, mapLink, mergeCarryList, sheetToDo, sortSheetVisits } from "./day-sheet.js";

describe("what to carry", () => {
  it("cleans a kind of service's list: blanks and repeats out, the order kept", () => {
    expect(cleanCarryList(["Ladder", "  harness ", "", "ladder", "Hood  brushes"])).toEqual(["Ladder", "harness", "Hood brushes"]);
    expect(carryItemsSchema.parse([" Ladder", "LADDER", "Gloves"])).toEqual(["Ladder", "Gloves"]);
    expect(carryItemsSchema.safeParse(Array.from({ length: 21 }, (_, index) => `Thing ${index}`)).success).toBe(false);
  });

  it("merges the day's visits: each thing once, with the visits that need it, in the order of the day", () => {
    const merged = mergeCarryList([
      { visitId: "v1", outletName: "Biryani House", time: "07:00", items: ["Degreaser", "Gloves"] },
      { visitId: "v2", outletName: "Spice Route", time: "15:30", items: ["Ladder", "gloves", "Harness"] },
      { visitId: "v3", outletName: "Hyderabad Kitchen", time: "17:30", items: [] },
    ]);
    expect(merged).toEqual([
      { item: "Degreaser", visits: [{ visitId: "v1", outletName: "Biryani House", time: "07:00" }] },
      {
        item: "Gloves",
        visits: [
          { visitId: "v1", outletName: "Biryani House", time: "07:00" },
          { visitId: "v2", outletName: "Spice Route", time: "15:30" },
        ],
      },
      { item: "Ladder", visits: [{ visitId: "v2", outletName: "Spice Route", time: "15:30" }] },
      { item: "Harness", visits: [{ visitId: "v2", outletName: "Spice Route", time: "15:30" }] },
    ]);
  });

  it("lists a visit once under a thing, even when its service names it twice", () => {
    expect(mergeCarryList([{ visitId: "v1", outletName: "A", time: null, items: ["Mop", "mop"] }])[0]?.visits).toHaveLength(1);
  });
});

describe("the visits", () => {
  it("links to the outlet's saved place, else its address, else nothing", () => {
    expect(mapLink({ latitude: 17.43, longitude: 78.41, address: "Road 36" })).toBe("https://www.google.com/maps/search/?api=1&query=17.43,78.41");
    expect(mapLink({ latitude: null, longitude: null, address: "Road 36, Jubilee Hills" })).toBe(
      "https://www.google.com/maps/search/?api=1&query=Road%2036%2C%20Jubilee%20Hills",
    );
    expect(mapLink({ latitude: null, longitude: null, address: " " })).toBeNull();
  });

  it("orders by time, with after-closing last", () => {
    const sorted = sortSheetVisits([
      { slot: "AFTER_CLOSING" as const, outletName: "C" },
      { slot: "1400" as const, outletName: "B" },
      { slot: "0800" as const, outletName: "A" },
      { slot: null, outletName: "D" },
    ]);
    expect(sorted.map((visit) => visit.outletName)).toEqual(["A", "B", "C", "D"]);
  });

  it("changes its key when a visit moves, comes or goes, whatever the order", () => {
    const sent = daySheetKey([
      { visitId: "a", slot: "0800" },
      { visitId: "b", slot: "1400" },
    ]);
    expect(
      daySheetKey([
        { visitId: "b", slot: "1400" },
        { visitId: "a", slot: "0800" },
      ]),
    ).toBe(sent);
    expect(
      daySheetKey([
        { visitId: "a", slot: "1000" },
        { visitId: "b", slot: "1400" },
      ]),
    ).not.toBe(sent);
    expect(daySheetKey([{ visitId: "a", slot: "0800" }])).not.toBe(sent);
  });
});

describe("still to do today", () => {
  it("lists the Supervisor's own work first, what waits on the restaurant last", () => {
    const items = sheetToDo({
      visits: [
        { visitId: "v1", outletName: "Signed", finished: true, hasBefore: true, hasAfter: true, awaitingSignOff: true },
        { visitId: "v2", outletName: "Open", finished: false, hasBefore: false, hasAfter: false, awaitingSignOff: false },
        { visitId: "v3", outletName: "No photos", finished: true, hasBefore: false, hasAfter: true, awaitingSignOff: false },
        { visitId: "v4", outletName: "Done", finished: true, hasBefore: true, hasAfter: true, awaitingSignOff: false },
      ],
      inspections: [{ inspectionId: "i1", outletName: "Audit" }],
      returned: [{ visitId: "v5", outletName: "Sent back" }],
    });
    expect(items.map((item) => `${item.kind}:${item.outletName}`)).toEqual([
      "FINISH:Open",
      "PHOTOS:No photos",
      "RETURNED:Sent back",
      "INSPECTION:Audit",
      "SIGN_OFF:Signed",
    ]);
  });
});
