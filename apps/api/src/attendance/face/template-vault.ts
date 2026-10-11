import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { env } from '../../config/env.js';

// Face templates are locked before they go into the database and unlocked only
// in the server's memory, for the moment a face is being compared. Someone who
// obtained a copy of the database alone could not read them. A face cannot be
// changed like a password, so the templates get this extra lock.
//
// The lock is AES-256-GCM. Each template is stored as: 12 bytes of nonce (a
// fresh random number per template), 16 bytes of check tag, then the locked
// numbers. The person's id is mixed into the check, so a template copied onto
// another person's row will not open.

/** Used outside production when FACE_TEMPLATE_KEY is not set. The same value .env.example carries. */
const DEV_KEY = 'dev-only-face-template-key-change-me-in-production';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export class TemplateVault {
  private readonly key: Buffer;

  constructor(secret: string | undefined = env.FACE_TEMPLATE_KEY) {
    if (!secret) {
      // Production never reaches this: env.ts refuses to start there without the key.
      new Logger('TemplateVault').warn('FACE_TEMPLATE_KEY is not set: face templates are encrypted with the development key. Set it in .env.');
    }
    // Any long secret is turned into exactly the 32 bytes the cipher needs.
    this.key = createHash('sha256').update(secret ?? DEV_KEY).digest();
  }

  seal(template: Float32Array, staffMemberId: string): Uint8Array<ArrayBuffer> {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(staffMemberId));
    const plain = Buffer.from(template.buffer, template.byteOffset, template.byteLength);
    const locked = Buffer.concat([cipher.update(plain), cipher.final()]);
    return new Uint8Array(Buffer.concat([nonce, cipher.getAuthTag(), locked]));
  }

  /** Throws if the bytes were altered, belong to another person, or were locked with a different key. */
  open(sealed: Uint8Array, staffMemberId: string): Float32Array {
    const bytes = Buffer.from(sealed);
    const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, NONCE_BYTES));
    decipher.setAAD(Buffer.from(staffMemberId));
    decipher.setAuthTag(bytes.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES));
    const plain = Buffer.concat([decipher.update(bytes.subarray(NONCE_BYTES + TAG_BYTES)), decipher.final()]);
    // Copied out, so the numbers start on a boundary a Float32Array accepts.
    return new Float32Array(plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength));
  }
}
