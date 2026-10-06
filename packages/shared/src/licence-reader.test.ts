import { describe, expect, it } from "vitest";
import { findDates, parseLicenceText } from "./licence-reader.js";

const TODAY = "2026-10-06";

describe("findDates", () => {
  it("reads the day-first forms used on Indian documents", () => {
    const values = (text: string) => findDates(text).map((date) => date.value);
    expect(values("31/03/2027")).toEqual(["2027-03-31"]);
    expect(values("31-03-2027 and 1.4.27")).toEqual(["2027-03-31", "2027-04-01"]);
    expect(values("31 March 2027")).toEqual(["2027-03-31"]);
    expect(values("31-Mar-2027")).toEqual(["2027-03-31"]);
    expect(values("31st Mar, 2027")).toEqual(["2027-03-31"]);
    expect(values("March 31, 2027")).toEqual(["2027-03-31"]);
    expect(values("2027-03-31")).toEqual(["2027-03-31"]);
  });

  it("ignores things that are not real dates", () => {
    expect(findDates("31/02/2027")).toEqual([]);
    expect(findDates("45/13/2027")).toEqual([]);
    expect(findDates("Plot 12/3/45678")).toEqual([]);
    expect(findDates("12 Marching 2027")).toEqual([]);
    expect(findDates("01/01/1850")).toEqual([]);
  });
});

describe("parseLicenceText", () => {
  it("reads a typical FSSAI licence", () => {
    const text = `
      Government of India
      Food Safety and Standards Authority of India
      License under FSS Act, 2006
      License Number : 1 3 6 2 2 0 1 2 0 0 0 4 5 6
      Name & Registered Office Address of Licensee : Spice Route Kitchens Pvt Ltd
      Kind of Business : Restaurant
      Issued On : 01-04-2026
      Valid Upto : 31-03-2027
    `;
    expect(parseLicenceText(text, TODAY)).toEqual({
      type: "FSSAI",
      number: "13622012000456",
      issuedOn: "2026-04-01",
      expiresOn: "2027-03-31",
      textFound: true,
    });
  });

  it("reads a fire NOC with worded dates and a labelled number", () => {
    const text = `
      TELANGANA STATE DISASTER RESPONSE AND FIRE SERVICES DEPARTMENT
      NO OBJECTION CERTIFICATE
      NOC No: FIRE/HYD/2026/00871
      Date of Issue: 12 June 2026
      This certificate is valid till 11 June 2027 subject to the conditions overleaf.
    `;
    expect(parseLicenceText(text, TODAY)).toMatchObject({
      type: "FIRE_NOC",
      number: "FIRE/HYD/2026/00871",
      issuedOn: "2026-06-12",
      expiresOn: "2027-06-11",
    });
  });

  it("reads a trade licence and a pest control contract", () => {
    expect(
      parseLicenceText("GHMC Trade Licence\nLicence No. TL-2026-55190\nValidity: 01/04/2026 to 31/03/2027", TODAY),
    ).toMatchObject({ type: "TRADE_LICENCE", number: "TL-2026-55190", expiresOn: "2027-03-31" });

    expect(
      parseLicenceText("Annual Pest Control Service Contract\nContract No: PC/7781\nValid from 15.09.2026\nExpiry Date 14.09.2027", TODAY),
    ).toMatchObject({ type: "PEST_CONTROL", number: "PC/7781", issuedOn: "2026-09-15", expiresOn: "2027-09-14" });
  });

  it("takes the later of two dates as the expiry when the wording gives no clue", () => {
    expect(parseLicenceText("Some Certificate\n01/04/2026\n31/03/2027", TODAY)).toMatchObject({
      type: null,
      issuedOn: "2026-04-01",
      expiresOn: "2027-03-31",
    });
  });

  it("leaves fields empty rather than guess", () => {
    // One unlabelled date could be anything.
    expect(parseLicenceText("Certificate of something\nHyderabad, 14/08/2026", TODAY)).toMatchObject({
      number: null,
      expiresOn: null,
    });
    // A "number" with no digits is a misread.
    expect(parseLicenceText("Licence No: PENDING\nValid till 31/03/2027", TODAY).number).toBeNull();
    // Not an FSSAI document, so a long digit string is not taken as its number.
    expect(parseLicenceText("Invoice 12345678901234 dated 01/01/2026 valid upto 01/02/2026", TODAY).type).toBeNull();
  });

  it("reports when there was no text to read", () => {
    expect(parseLicenceText("", TODAY)).toEqual({ type: null, number: null, issuedOn: null, expiresOn: null, textFound: false });
    expect(parseLicenceText("  \n . ", TODAY).textFound).toBe(false);
  });

  it("copes with the noise OCR adds", () => {
    const text = "F S S A I\nFood  Safety and   Standards Authority\nLicense   Number :  13622012000456\nVa1id Upto :  31 - 03 - 2027";
    // "Va1id" defeats the keyword, but "Upto" still anchors the expiry.
    expect(parseLicenceText(text, TODAY)).toMatchObject({ type: "FSSAI", number: "13622012000456", expiresOn: "2027-03-31" });
  });
});
