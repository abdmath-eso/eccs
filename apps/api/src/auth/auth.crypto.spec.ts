import { generateOutletCode, generatePin, normalizeOutletCode, pinLookup } from '@eccs/db';
import { newToken, randomOtp, safeEqualHex, sha256 } from './auth.crypto.js';

describe('auth crypto helpers', () => {
  it('compares hashes safely', () => {
    expect(safeEqualHex(sha256('a'), sha256('a'))).toBe(true);
    expect(safeEqualHex(sha256('a'), sha256('b'))).toBe(false);
    expect(safeEqualHex(sha256('a'), 'abcd')).toBe(false);
  });

  it('generates six-digit codes and long unique tokens', () => {
    expect(randomOtp()).toMatch(/^\d{6}$/);
    expect(newToken().length).toBeGreaterThanOrEqual(43);
    expect(newToken()).not.toBe(newToken());
  });
});

describe('PIN helpers', () => {
  it('ties the stored value to the secret and the organisation', () => {
    const stored = pinLookup('secret-one', 'org-1', '4821');
    expect(stored).not.toContain('4821');
    expect(pinLookup('secret-one', 'org-1', '4821')).toBe(stored);
    expect(pinLookup('secret-one', 'org-2', '4821')).not.toBe(stored);
    expect(pinLookup('secret-two', 'org-1', '4821')).not.toBe(stored);
  });

  it('never generates an obvious PIN', () => {
    for (let i = 0; i < 2000; i++) {
      const pin = generatePin();
      expect(pin).toMatch(/^\d{4}$/);
      expect(['0000', '1111', '1234', '4321', '9999', '6789']).not.toContain(pin);
    }
  });

  it('makes restaurant codes that survive being typed loosely', () => {
    const code = generateOutletCode('Spice Route, Jubilee Hills');
    expect(code).toMatch(/^SPICE-[2-9A-Z]{6}$/);
    expect(normalizeOutletCode(code.toLowerCase().replace('-', ' '))).toBe(code);
    expect(normalizeOutletCode(' spice jh2k7m ')).toBe('SPICE-JH2K7M');
  });
});
