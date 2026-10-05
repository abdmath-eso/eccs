import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export const newSessionToken = () => randomBytes(32).toString('base64url');

export const randomOtp = () => randomInt(0, 1_000_000).toString().padStart(6, '0');

/** A 4-digit PIN has little entropy, so it is salted and stretched, and attempts are limited. */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(pin, salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPinHash(pin: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const hash = await scryptAsync(pin, Buffer.from(saltHex, 'hex'), 32);
  return safeEqualHex(hash.toString('hex'), hashHex);
}
