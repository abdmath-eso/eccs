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
    // The address diners reach the customer QR page at, without the "/k/<token>" part.
    // It is what every printed QR code holds, so it must be a real, lasting web address
    // before any code is printed. Unset, it falls back to WEB_URL, which today is this PC.
    PUBLIC_PAGE_BASE_URL: z.string().optional(),
    SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
    // Key for storing restaurant PINs. Changing it invalidates every PIN.
    PIN_SECRET: z.string().min(16),
    // Key for signing the short-lived links that display photos.
    FILE_URL_SECRET: z.string().min(16),
    // Reading licence details off uploaded documents: "ai" (the default) sends the photo
    // or PDF to the AI and falls back to "ocr" whenever AI is off, over its limit or
    // fails; "ocr" uses only the free reader on this server; "off" reads nothing.
    LICENCE_READER: z.enum(['ai', 'ocr', 'off']).default('ai'),
    // ── AI (the Claude API), 14 Oct 2026. See apps/api/src/ai. ──
    // The key from Anthropic's console. Read here on the server only: it is never sent
    // to the apps, never written to a file other than .env, and never logged. Without
    // it every AI feature is off by itself and the app works as before.
    ANTHROPIC_API_KEY: z.string().optional(),
    // The main switch: "off" turns every AI feature off.
    AI_FEATURES: z.enum(['on', 'off']).default('on'),
    // "real" calls Anthropic; "fake" gives fixed answers with no network call, for the
    // automated tests (vitest.config.e2e.ts sets it). Left unset, tests use "fake".
    AI_ENGINE: z.enum(['real', 'fake']).optional(),
    // The most to spend on AI in one day (India time), in US dollars, across everything,
    // and the most for any one outlet. Over either, AI steps aside until the next day.
    AI_DAILY_LIMIT_USD: z.coerce.number().min(0).default(2),
    AI_OUTLET_DAILY_LIMIT_USD: z.coerce.number().min(0).default(0.25),
    // Feature names to switch off one by one, separated by commas, e.g. "explain-score".
    // The names are AI_FEATURES in packages/shared/src/ai.ts.
    AI_DISABLED_FEATURES: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean),
      ),
    // How restaurants reach ECCS directly. Sample numbers until the real ones are supplied.
    SUPPORT_PHONE: z.string().default('+919000000000'),
    SUPPORT_WHATSAPP: z.string().default('919000000000'),
    SUPPORT_HOURS: z.string().default('Every day, 8 am to 10 pm'),
    // The browser that prints service reports to PDF (Chrome, Edge or Chromium). Leave unset
    // to use one found in the usual places; set it on a server where it is installed elsewhere.
    PDF_BROWSER_PATH: z.string().optional(),
    // Push notifications to phones, through Expo's push service. "off" (the default) sends
    // nothing; "on" also sends every new notification to the person's registered phones.
    // The words of each notification then pass through Expo's and Google's (or Apple's) servers.
    PUSH_NOTIFICATIONS: z.enum(['on', 'off']).default('off'),
    // Only if "enhanced security for push notifications" is switched on for the project at expo.dev.
    EXPO_ACCESS_TOKEN: z.string().optional(),
    // Object storage for photos and documents. Locally this is SeaweedFS; in production, Amazon S3.
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('ap-south-1'),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    // Face attendance. Which engine recognises faces: "onnx" runs the models in
    // apps/api/models on this server (the default); "off" switches recognition off, leaving
    // the assisted route; "fake" is for automated tests only and recognises nobody real.
    // Left unset, tests use "fake" and everything else uses "onnx".
    FACE_ENGINE: z.enum(['onnx', 'fake', 'off']).optional(),
    // Where the model files are, if not in apps/api/models.
    FACE_MODELS_DIR: z.string().optional(),
    // Key the face templates are encrypted with in the database. Changing or losing it makes
    // every stored template unreadable: all enrolled staff would have to enrol again.
    FACE_TEMPLATE_KEY: z.string().min(32).optional(),
    // Restaurant users (Owner, Manager, Head Chef) must agree to the Terms of Service and
    // Privacy Policy before using the app. "on" (the default) makes the server refuse their
    // other requests until they have; "off" stops the refusing (the app still asks them).
    // The automated tests switch it off for the whole run (vitest.config.e2e.ts).
    LEGAL_GATE: z.enum(['on', 'off']).default('on'),
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
  )
  .refine((env) => !(env.NODE_ENV === 'production' && (!env.FACE_TEMPLATE_KEY || env.FACE_TEMPLATE_KEY.startsWith('dev-only'))), {
    message: 'FACE_TEMPLATE_KEY must be set to a long random secret in production',
  })
  .refine((env) => !(env.NODE_ENV === 'production' && env.FACE_ENGINE === 'fake'), {
    message: 'FACE_ENGINE must not be "fake" in production',
  })
  .refine((env) => !(env.NODE_ENV === 'production' && env.AI_ENGINE === 'fake'), {
    message: 'AI_ENGINE must not be "fake" in production',
  });

export type Env = z.infer<typeof schema>;

export const env: Env = schema.parse(process.env);
