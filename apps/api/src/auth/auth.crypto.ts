import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Used for session tokens and linked-device tokens. Only their hash is stored. */
export const newToken = () => randomBytes(32).toString('base64url');

export const randomOtp = () => randomInt(0, 1_000_000).toString().padStart(6, '0');
