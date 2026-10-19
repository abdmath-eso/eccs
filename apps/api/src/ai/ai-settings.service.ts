import { BadRequestException, ConflictException, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  AI_FEATURES,
  AI_SETTINGS_RULES,
  AI_SETTINGS_SECTIONS,
  aiSettingChangeLine,
  aiSettingsChanges,
  aiSettingsDefaults,
  aiSettingsSchema,
  applyAiSettingsPatch,
  mainRole,
  readAiSettings,
  ROLE_LABELS,
  type AiFeature,
  type AiSettings,
  type AiSettingsHistoryEntryDto,
  type aiSettingsPatchSchema,
  type AiSettingsSection,
  type Role,
} from '@eccs/shared';
import type { Prisma } from '@eccs/db';
import type { z } from 'zod';
import { noteActivity } from '../activity-log/activity-context.js';
import type { AuthUser } from '../auth/auth.types.js';
import { env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

// The AI settings kept in the database (Stage F, 19 Oct 2026), changed from the console's
// AI usage page. AiService reads them through `current`, a copy held in memory: it is
// replaced at once when this server saves a change, and read again from the database when
// it is older than half a minute (for a second copy of the server sharing the database),
// so a change takes effect on the next request without a restart.
//
// What stays with the server's .env, above anything saved here: AI_FEATURES=off switches
// every helper off, AI_DISABLED_FEATURES switches the helpers it names off, and without an
// API key nothing runs. A test copy started with AI_SETTINGS_FROM_ENV=on takes its limits
// and Buddy settings from its own .env and cannot save (it shares the founder's database).

/** The settings row's key: the server's own, or the automated tests' (never the real one). */
const SETTINGS_ID = env.NODE_ENV === 'test' ? 'e2e' : 'main';
/** How long the copy in memory is trusted before it is read again. */
const FRESH_FOR_MS = 30_000;

type Patch = z.output<typeof aiSettingsPatchSchema>;

/** The defaults: today's .env values (AI_DAILY_LIMIT_USD, BUDDY_*), so the first start changes nothing. */
export const settingsFromEnv = (): AiSettings =>
  aiSettingsDefaults({
    dailyLimitUsd: env.AI_DAILY_LIMIT_USD,
    outletDailyLimitUsd: env.AI_OUTLET_DAILY_LIMIT_USD,
    buddyModel: env.BUDDY_MODEL,
    buddyEffort: env.BUDDY_EFFORT,
    buddyThinking: env.BUDDY_THINKING,
    buddyScreen: env.BUDDY_SCREEN === 'on',
    buddyDailyMessages: env.BUDDY_DAILY_MESSAGES,
    buddyPerMinute: env.BUDDY_PER_MINUTE,
    buddyBlocksBeforePause: env.BUDDY_BLOCKS_BEFORE_PAUSE,
  });

interface StoredChange extends AiSettingsHistoryEntryDto {
  userId: string;
}

@Injectable()
export class AiSettingsService implements OnModuleInit {
  private readonly logger = new Logger('AiSettings');
  private readonly defaults = settingsFromEnv();
  private saved: AiSettings = this.defaults;
  private history: StoredChange[] = [];
  private loadedAt = 0;
  private loading: Promise<void> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  /** True on a test copy that takes its settings from its own .env. */
  get fromEnv(): boolean {
    return env.AI_SETTINGS_FROM_ENV === 'on';
  }

  async onModuleInit() {
    await this.load().catch((error) => this.logger.warn(`Could not read the AI settings; the defaults apply for now (${String(error)})`));
  }

  /** The settings in force now, from memory. */
  get current(): AiSettings {
    return this.fromEnv ? this.defaults : this.saved;
  }

  /** The latest changes, newest first. */
  get changes(): StoredChange[] {
    return this.history;
  }

  /** Reads the settings again when the copy in memory is more than half a minute old. Never throws. */
  async fresh(): Promise<AiSettings> {
    if (!this.fromEnv && Date.now() - this.loadedAt > FRESH_FOR_MS) {
      this.loading ??= this.load()
        .catch((error) => this.logger.warn(`Could not read the AI settings; keeping the last ones (${String(error)})`))
        .finally(() => (this.loading = null));
      await this.loading;
    }
    return this.current;
  }

  private async load(): Promise<void> {
    const row = await this.db.aiSettings.findUnique({ where: { id: SETTINGS_ID } });
    this.saved = row ? readAiSettings(row.settings, this.defaults) : this.defaults;
    this.history = row ? readHistory(row.history) : [];
    this.loadedAt = Date.now();
  }

  /**
   * Saves a change from the console: laid over what is saved, checked whole, kept with
   * who made it and what changed from and to (the activity log gets the same lines).
   * Nothing is written when nothing changed.
   */
  async save(user: AuthUser, patch: Patch): Promise<AiSettings> {
    if (this.fromEnv) {
      throw new ConflictException({ message: 'This copy of the server takes its AI settings from its own .env (AI_SETTINGS_FROM_ENV), so they cannot be changed here', code: 'AI_SETTINGS_FROM_ENV' });
    }
    // Read again first, so a change saved a moment ago by another copy of the server is built on.
    await this.load();
    const before = this.saved;
    const checked = aiSettingsSchema.safeParse(applyAiSettingsPatch(before, patch));
    if (!checked.success) {
      const issue = checked.error.issues[0];
      throw new BadRequestException({
        message: issue?.message ?? 'Those settings are not allowed',
        issues: checked.error.issues.map((entry) => ({ path: entry.path.join('.'), message: entry.message })),
      });
    }
    const after = checked.data;
    const changes = aiSettingsChanges(before, after);
    if (changes.length === 0) return before;

    const role = mainRole(user.memberships.map((m) => m.role as Role));
    const entry: StoredChange = { at: new Date().toISOString(), userId: user.id, by: user.name, role: role ? ROLE_LABELS[role] : null, changes };
    const history = [entry, ...this.history].slice(0, AI_SETTINGS_RULES.historyKept);
    const data = {
      settings: after as unknown as Prisma.InputJsonValue,
      history: history as unknown as Prisma.InputJsonValue,
      updatedById: user.id,
      updatedByName: user.name,
    };
    await this.db.aiSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID, ...data }, update: data });
    this.saved = after;
    this.history = history;
    this.loadedAt = Date.now();

    // The activity log keeps what changed from and to, in words (no secrets are involved).
    const lines = changes.map(aiSettingChangeLine);
    noteActivity({
      entity: { type: 'aiSettings', id: SETTINGS_ID, label: 'AI settings' },
      details: { changes: lines.slice(0, 12), ...(lines.length > 12 && { more: lines.length - 12 }) },
    });
    this.logger.log(`AI settings changed by ${user.name}: ${lines.join('; ')}`);
    return after;
  }

  /** Who last changed each group of settings, from the history kept. */
  sectionsChanged(): Record<AiSettingsSection, { at: string; by: string } | null> {
    const sections = Object.fromEntries(AI_SETTINGS_SECTIONS.map((section) => [section, null])) as Record<AiSettingsSection, { at: string; by: string } | null>;
    for (const entry of [...this.history].reverse()) {
      for (const change of entry.changes) sections[change.section] = { at: entry.at, by: entry.by };
    }
    return sections;
  }

  // ───────────────────────── Tests only ─────────────────────────

  /** Tests: the key of the row the tests write, so they remove exactly that one. */
  static readonly testRowId = 'e2e';

  /** Tests: forget the copy in memory, so the next read goes to the database. */
  forgetForTest(): void {
    if (env.NODE_ENV !== 'test') throw new Error('Only in tests');
    this.saved = this.defaults;
    this.history = [];
    this.loadedAt = 0;
  }
}

/** The history column read back, keeping only entries in the expected shape. */
function readHistory(value: unknown): StoredChange[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is StoredChange =>
      typeof entry === 'object' && entry !== null && typeof (entry as StoredChange).at === 'string' && Array.isArray((entry as StoredChange).changes),
  );
}

/** Helpers switched off in the server's .env (AI_DISABLED_FEATURES), known names only. */
export const serverDisabled = (names: readonly string[]): AiFeature[] => AI_FEATURES.filter((feature) => names.includes(feature));

