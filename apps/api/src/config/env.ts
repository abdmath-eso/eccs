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
    // Sample mode: every login code is this value and no SMS is sent.
    DEV_FIXED_OTP: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
  })
  .refine((env) => !(env.NODE_ENV === 'production' && env.DEV_FIXED_OTP), {
    message: 'DEV_FIXED_OTP must not be set in production',
  });

export type Env = z.infer<typeof schema>;

export const env: Env = schema.parse(process.env);
