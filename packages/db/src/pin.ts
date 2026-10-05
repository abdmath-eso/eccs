import { createHmac, randomInt } from "node:crypto";

// Restaurant staff log in with a 4-digit PIN that is unique within their
// organisation. A PIN that short cannot be protected by slow hashing alone
// (there are only 10,000 of them), so it is stored as a keyed hash: without
// the server's PIN_SECRET the stored value cannot be turned back into a PIN.
// Guessing is limited by requiring a linked device and locking it after
// repeated wrong attempts.

export const PIN_LENGTH = 4;

export function pinLookup(secret: string, organizationId: string, pin: string): string {
  return createHmac("sha256", secret).update(`${organizationId}:${pin}`).digest("hex");
}

const isObvious = (pin: string) =>
  /^(\d)\1+$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin);

/** A random PIN that is not something like 0000 or 1234. */
export function generatePin(): string {
  for (;;) {
    const pin = randomInt(0, 10 ** PIN_LENGTH).toString().padStart(PIN_LENGTH, "0");
    if (!isObvious(pin)) return pin;
  }
}

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O, 1/I/L

/** A restaurant code such as "SPICE-7K2M9Q": a readable prefix plus six random characters. */
export function generateOutletCode(outletName: string): string {
  const prefix = outletName.replace(/[^A-Za-z]/g, "").slice(0, 5).toUpperCase() || "ECCS";
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  return `${prefix}-${suffix}`;
}

/** Restaurant codes are matched ignoring case, spaces and the dash. */
export const normalizeOutletCode = (input: string) => {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.length > 6 ? `${cleaned.slice(0, -6)}-${cleaned.slice(-6)}` : cleaned;
};
