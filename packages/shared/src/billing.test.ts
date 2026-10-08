import { describe, expect, it } from "vitest";
import {
  amountInWords,
  calculateGst,
  financialYear,
  gstOn,
  invoiceDueDate,
  invoiceNumber,
  invoiceOverdueDays,
  recordPaymentSchema,
} from "./billing.js";

describe("calculateGst", () => {
  it("charges CGST and SGST, half each, to a buyer in Telangana", () => {
    const gst = calculateGst([{ taxablePaise: 250_000, gstRatePercent: 18 }], "36");
    expect(gst).toMatchObject({
      interState: false,
      placeOfSupply: "36",
      subtotalPaise: 250_000,
      cgstPaise: 22_500,
      sgstPaise: 22_500,
      igstPaise: 0,
      taxPaise: 45_000,
      totalPaise: 295_000,
    });
    expect(gst.lines[0]).toMatchObject({ cgstPaise: 22_500, sgstPaise: 22_500, igstPaise: 0, totalPaise: 295_000 });
  });

  it("treats a buyer with no state on record as being in ECCS's state", () => {
    for (const state of [null, undefined, "", "  "]) {
      expect(calculateGst([{ taxablePaise: 100_000, gstRatePercent: 18 }], state)).toMatchObject({
        interState: false,
        placeOfSupply: "36",
        cgstPaise: 9000,
        sgstPaise: 9000,
        igstPaise: 0,
      });
    }
  });

  it("charges IGST at the full rate to a buyer in another state", () => {
    expect(calculateGst([{ taxablePaise: 250_000, gstRatePercent: 18 }], "29")).toMatchObject({
      interState: true,
      placeOfSupply: "29",
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 45_000,
      totalPaise: 295_000,
    });
  });

  it("rounds each tax on each line to the nearest paisa, half a paisa up, and adds the lines", () => {
    // 9% of 105 paise is 9.45 → 9; 9% of 150 paise is 13.5 → 14.
    const gst = calculateGst(
      [
        { taxablePaise: 105, gstRatePercent: 18 },
        { taxablePaise: 150, gstRatePercent: 18 },
      ],
      "36",
    );
    expect(gst.lines.map((line) => line.cgstPaise)).toEqual([9, 14]);
    expect(gst.lines.map((line) => line.sgstPaise)).toEqual([9, 14]);
    expect(gst).toMatchObject({ subtotalPaise: 255, cgstPaise: 23, sgstPaise: 23, totalPaise: 301 });
    // The same lines to another state: 18% of 105 is 18.9 → 19; of 150 is 27.
    expect(calculateGst(gst.lines, "27")).toMatchObject({ igstPaise: 46, totalPaise: 301 });
  });

  it("keeps lines at different rates apart, and an invoice with no lines at nothing", () => {
    const gst = calculateGst(
      [
        { taxablePaise: 100_000, gstRatePercent: 18 },
        { taxablePaise: 100_000, gstRatePercent: 5 },
        { taxablePaise: 100_000, gstRatePercent: 0 },
      ],
      "36",
    );
    expect(gst.lines.map((line) => line.cgstPaise)).toEqual([9000, 2500, 0]);
    expect(gst.totalPaise).toBe(323_000);
    expect(calculateGst([], "36")).toMatchObject({ subtotalPaise: 0, taxPaise: 0, totalPaise: 0 });
  });

  it("can be told ECCS is somewhere else", () => {
    expect(calculateGst([{ taxablePaise: 1000, gstRatePercent: 18 }], "36", "29").interState).toBe(true);
  });
});

describe("gstOn", () => {
  it("is the tax on a price, to the nearest paisa", () => {
    expect(gstOn(250_000, 18)).toBe(45_000);
    expect(gstOn(105, 18)).toBe(19);
    expect(gstOn(0, 18)).toBe(0);
  });
});

describe("amountInWords", () => {
  it("writes rupees the Indian way, with lakh and crore", () => {
    expect(amountInWords(0)).toBe("Rupees Zero Only");
    expect(amountInWords(100)).toBe("Rupees One Only");
    expect(amountInWords(1_900)).toBe("Rupees Nineteen Only");
    expect(amountInWords(295_000)).toBe("Rupees Two Thousand Nine Hundred Fifty Only");
    expect(amountInWords(10_000_000)).toBe("Rupees One Lakh Only");
    expect(amountInWords(12_345_600)).toBe("Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six Only");
    expect(amountInWords(1_000_000_000)).toBe("Rupees One Crore Only");
    expect(amountInWords(1_234_567_800)).toBe("Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only");
    expect(amountInWords(100_000_000_000)).toBe("Rupees One Hundred Crore Only");
    expect(amountInWords(1_000_500)).toBe("Rupees Ten Thousand Five Only");
  });

  it("adds the paise when there are any", () => {
    expect(amountInWords(12_345_678)).toBe(
      "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Seventy Eight Paise Only",
    );
    expect(amountInWords(5)).toBe("Rupees Zero and Five Paise Only");
    expect(amountInWords(150)).toBe("Rupees One and Fifty Paise Only");
  });
});

describe("invoice numbers", () => {
  it("puts a date in the financial year that runs from 1 April to 31 March", () => {
    expect(financialYear("2026-10-08")).toEqual({ startYear: 2026, label: "26-27" });
    expect(financialYear("2027-03-31")).toEqual({ startYear: 2026, label: "26-27" });
    expect(financialYear("2027-04-01")).toEqual({ startYear: 2027, label: "27-28" });
    expect(financialYear("2027-01-01")).toEqual({ startYear: 2026, label: "26-27" });
    expect(financialYear("2099-12-31").label).toBe("99-00");
  });

  it("numbers within the year, in 16 characters at most", () => {
    expect(invoiceNumber("2026-10-08", 1)).toBe("ECCS/26-27/00001");
    expect(invoiceNumber("2027-04-01", 1)).toBe("ECCS/27-28/00001");
    expect(invoiceNumber("2026-10-08", 99_999)).toHaveLength(16);
    expect(() => invoiceNumber("2026-10-08", 100_000)).toThrow();
  });
});

describe("due dates", () => {
  it("is due seven days after it is issued", () => {
    expect(invoiceDueDate("2026-10-08")).toBe("2026-10-15");
    expect(invoiceDueDate("2026-12-28")).toBe("2027-01-04");
  });

  it("is overdue from the day after the due date, while something is owed", () => {
    expect(invoiceOverdueDays("2026-10-15", "2026-10-15", 1000)).toBe(0);
    expect(invoiceOverdueDays("2026-10-15", "2026-10-16", 1000)).toBe(1);
    expect(invoiceOverdueDays("2026-10-15", "2026-11-14", 1000)).toBe(30);
    expect(invoiceOverdueDays("2026-10-15", "2026-10-01", 1000)).toBe(0);
    expect(invoiceOverdueDays("2026-10-15", "2026-11-14", 0)).toBe(0);
  });
});

describe("recordPaymentSchema", () => {
  const base = { amountPaise: 1000, paidOn: "2026-10-08" };
  it("needs a reference for everything but cash", () => {
    expect(recordPaymentSchema.safeParse({ ...base, method: "cash" }).success).toBe(true);
    expect(recordPaymentSchema.safeParse({ ...base, method: "cheque" }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ ...base, method: "cheque", reference: " 000123 " }).success).toBe(true);
    expect(recordPaymentSchema.safeParse({ ...base, method: "card", reference: "x" }).success).toBe(false);
  });
  it("needs a whole number of paise above zero", () => {
    expect(recordPaymentSchema.safeParse({ ...base, method: "cash", amountPaise: 0 }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ ...base, method: "cash", amountPaise: 10.5 }).success).toBe(false);
  });
});
