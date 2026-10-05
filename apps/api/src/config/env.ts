import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

// Local development reads the repo-root .env. In deployment the variables
// come from the host environment and no file is present.
const rootEnvFile = resolve(import.meta.dirname, '../../../../.env');
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().min(1),
    API_PORT: z.coerce.number().int().default(4000),
    WEB_URL: z.string().optional(),
    SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
    // Key for storing restaurant PINs. Changing it invalidates every PIN.
    PIN_SECRET: z.string().min(16),
    // Key for signing the short-lived links that display photos.
    FILE_URL_SECRET: z.string().min(16),
    // Object storage for photos and documents. Locally this is SeaweedFS; in production, Amazon S3.
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('ap-south-1'),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    // Sample mode: every login code is this value and no SMS is sent.
    DEV_FIXED_OTP: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
  })
  .refine((env) => !(env.NODE_ENV === 'production' && env.DEV_FIXED_OTP), {
    message: 'DEV_FIXED_OTP must not be set in production',
  })
  .refine(
    (env) =>
      !(env.NODE_ENV === 'production' && (env.PIN_SECRET.startsWith('dev-only') || env.FILE_URL_SECRET.startsWith('dev-only'))),
    { message: 'PIN_SECRET and FILE_URL_SECRET must be replaced with random secrets in production' },
  );

export type Env = z.infer<typeof schema>;

export const env: Env = schema.parse(process.env);
