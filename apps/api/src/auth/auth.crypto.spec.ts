import { hashPin, newSessionToken, randomOtp, safeEqualHex, sha256, verifyPinHash } from './auth.crypto.js';

describe('auth crypto helpers', () => {
  it('verifies the right PIN and rejects a wrong one', async () => {
    const stored = await hashPin('4821');
    expect(stored).not.toContain('4821');
    expect(await verifyPinHash('4821', stored)).toBe(true);
    expect(await verifyPinHash('4822', stored)).toBe(false);
    expect(await verifyPinHash('4821', 'not-a-hash')).toBe(false);
  });

  it('salts PIN hashes so equal PINs do not look equal', async () => {
    expect(await hashPin('1234')).not.toBe(await hashPin('1234'));
  });

  it('compares hashes safely', () => {
    expect(safeEqualHex(sha256('a'), sha256('a'))).toBe(true);
    expect(safeEqualHex(sha256('a'), sha256('b'))).toBe(false);
    expect(safeEqualHex(sha256('a'), 'abcd')).toBe(false);
  });

  it('generates six-digit codes and long unique tokens', () => {
    expect(randomOtp()).toMatch(/^\d{6}$/);
    expect(newSessionToken().length).toBeGreaterThanOrEqual(43);
    expect(newSessionToken()).not.toBe(newSessionToken());
  });
});
