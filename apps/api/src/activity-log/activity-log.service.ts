import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import type { Prisma } from '@eccs/db';
import {
  AI_FEATURE_ACTIONS,
  activityCategoryOf,
  activityResultFor,
  activitySource,
  isEccsRole,
  isOfflineEntry,
  isSafeFactValue,
  mainRole,
  safeDetails,
  shortText,
  type ActivityAction,
  type ActivityClient,
  type ActivityResult,
  type ActivitySource,
  type AiFeature,
  type AiStatus,
  type NotificationLink,
  type Role,
} from '@eccs/shared';
import type { Request, Response } from 'express';
import type { AuthUser } from '../auth/auth.types.js';
import { env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { currentActivity, type ActivityRequestContext } from './activity-context.js';
import { ACTIVITY_META, type ActivityMeta } from './activity.decorator.js';
import { resolveEntity, STAFF_ENTITY_KINDS, type EntityKind, type ResolvedEntity } from './activity-entities.js';

// The activity log's writer (15 Oct 2026). Rows come from three places:
// 1. every request, after its answer has gone (the middleware calls `afterResponse`),
//    labelled by the @Activity key on its handler;
// 2. events a service records itself (`event`: a phone locked after wrong PINs);
// 3. the server's own work (`system`, `jobRun`, `aiRequest`, `notificationSent`).
//
// Writing a row never slows down or breaks what it is about: rows are built after the
// answer has gone, kept for a quarter of a second and written together, and every
// error is caught and logged as a warning. Under tests it is off unless a test turns
// it on (ACTIVITY_LOG=off in vitest.config.e2e.ts).

type Row = Prisma.ActivityLogCreateManyInput;

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const FLUSH_AFTER_MS = 250;
/** How long `flush()` waits for requests still on their way out. */
const OPEN_REQUEST_WAIT_MS = 1_000;
const FLUSH_AT_ROWS = 100;
const NAME_CACHE_MS = 60_000;
const NAME_CACHE_MAX = 2_000;
const PRUNE_FIRST_AFTER_MS = 90_000;
const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000;
/** Body fields that carry when something was done on the phone (sent later from the outbox). */
const PHONE_TIME_FIELDS = ['at', 'capturedAt', 'preparedAt'] as const;
const REQUEST_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];
/** Notifications that are never logged: a checklist problem is the restaurant's own business. */
const UNLOGGED_NOTIFICATIONS = new Set(['CHECKLIST_PROBLEM']);

export interface ActivityEventFields {
  result?: ActivityResult;
  actor?: { id: string; name: string; role: Role | null } | null;
  organizationId?: string | null;
  outletId?: string | null;
  deviceId?: string | null;
  entity?: { kind?: EntityKind; type?: string; id: string | null; label?: string | null; reference?: string | null };
  details?: Record<string, unknown>;
  side?: 'restaurant' | 'eccs' | 'public';
}

/** The facts of one AI request, as AiService records it. */
export interface AiActivity {
  requestId: string;
  feature: AiFeature;
  model: string;
  status: AiStatus;
  errorCode?: string | null;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  durationMs: number;
  userId: string | null;
  organizationId: string | null;
  outletId: string | null;
}

interface Place {
  organizationId: string | null;
  organizationName: string | null;
  outletId: string | null;
  outletName: string | null;
}

const resultOfAi = (status: AiStatus): ActivityResult =>
  status === 'OK' ? 'SUCCESS' : status === 'OFF' || status === 'LIMIT' ? 'REFUSED' : 'FAILED';

@Injectable()
export class ActivityLogService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy, BeforeApplicationShutdown {
  private readonly logger = new Logger('ActivityLog');
  private settings = { on: env.ACTIVITY_LOG === 'on', failWrites: false };
  private buffer: Row[] = [];
  private readonly pending = new Set<Promise<void>>();
  /** Requests whose answer has not finished going out yet (see `requestOpened`). */
  private readonly open = new Set<Promise<void>>();
  /** Writes to the database under way, each holding rows already taken off the buffer. */
  private readonly writing = new Set<Promise<void>>();
  private flushTimer: NodeJS.Timeout | null = null;
  private timers: NodeJS.Timeout[] = [];
  private readonly places = new Map<string, { value: Place; until: number }>();
  private readonly routes = new WeakMap<object, string | null>();
  private readonly warned = new Set<string>();
  /** Tests only: the ids of the rows written, so the tests remove exactly their own. */
  private recorded: string[] | null = env.NODE_ENV === 'test' ? [] : null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  get enabled(): boolean {
    return this.settings.on;
  }

  /** Deletes rows past the keeping period shortly after the server starts and once a day after that. */
  onModuleInit() {
    // Tests prune at moments they choose.
    if (env.NODE_ENV === 'test') return;
    const prune = () => void this.prune().catch((error) => this.logger.warn(`Could not delete old log rows: ${String(error)}`));
    const first = setTimeout(prune, PRUNE_FIRST_AFTER_MS);
    const repeat = setInterval(prune, PRUNE_EVERY_MS);
    first.unref();
    repeat.unref();
    this.timers = [first, repeat];
  }

  onApplicationBootstrap() {
    if (env.NODE_ENV === 'test') return;
    this.system('system.server.started', { details: { keepDays: env.ACTIVITY_LOG_DAYS } });
  }

  onModuleDestroy() {
    for (const timer of this.timers) clearTimeout(timer);
  }

  /** What is still waiting is written before the server stops. */
  async beforeApplicationShutdown() {
    await this.flush();
  }

  // ───────────────────────── Requests ─────────────────────────

  /** Called by the middleware once the answer has gone (or the caller has gone away). Never throws. */
  afterResponse(request: Request, response: Response, context: ActivityRequestContext, finished: boolean): void {
    if (!this.settings.on) return;
    this.track(this.fromRequest(request, response, context, finished));
  }

  private async fromRequest(request: Request, response: Response, context: ActivityRequestContext, finished: boolean): Promise<Row | null> {
    const method = request.method.toUpperCase();
    if (method === 'OPTIONS' || !context.handler) return null;
    const meta = this.reflector.getAllAndOverride<ActivityMeta | undefined>(ACTIVITY_META, [context.handler, context.controller ?? Object]);
    if (meta?.never) return null;

    const statusCode = finished ? response.statusCode : 499;
    // Taken now, when the answer has just gone, before any looking-up below.
    const durationMs = Math.max(0, Date.now() - context.startedAt);
    const note = context.note;
    let action: ActivityAction | undefined = note.action ?? meta?.action;
    if (!MUTATING.has(method)) {
      const reads = meta?.reads;
      if (reads) {
        // A reading route that asks to be recorded: always, on failure, or when the handler said so
        // (and on a server error). Expired photo links (403) are not worth a row each.
        const wanted =
          reads === 'always' || (reads === 'failures' && statusCode >= 400) || (reads === 'noted' && (note.record === true || statusCode >= 500));
        if (!wanted) return null;
      } else if (statusCode === 403) {
        // Other reading routes are not recorded, except a refusal or a server error.
        action = 'auth.access.refused';
      } else if (statusCode >= 500) {
        action = 'system.request.failed';
      } else {
        return null;
      }
    }
    if (!action) {
      this.warnOnce(`no-action:${method}:${this.routeOf(context)}`, `No activity action on ${method} ${this.routeOf(context)}`);
      return null;
    }

    const user = (request as Request & { user?: AuthUser }).user;
    const roles = (user?.memberships ?? []).map((m) => m.role);
    const actor = user ? { id: user.id, name: user.name, role: mainRole(roles) } : (note.actor ?? null);
    const staffData = meta?.staffData === true;
    const body = plainObject(request.body);

    // The record: a note from the service, else what the route says, looked up now (or before a delete).
    const kind = meta?.entity;
    const entityId = kind ? this.entityIdOf(meta, context, body) : null;
    let resolved: ResolvedEntity | null = null;
    if (kind && entityId) {
      resolved = context.before ? ((await settle(context.before)) as ResolvedEntity | null) : await this.resolve(kind, entityId, action);
    }

    // Where: the service's note, the record, the request's own outletId, the person's own place.
    const own = user && actor?.role && !isEccsRole(actor.role) ? ownPlace(user) : { organizationId: null, outletId: null };
    const requested =
      meta?.place === false
        ? null
        : (stringOr(context.params?.outletId) ?? stringOr((request.query as Record<string, unknown>)?.outletId) ?? stringOr(body?.outletId));
    const outletId = pick(note.outletId, resolved?.outletId, requested, own.outletId);
    const organizationId = pick(note.organizationId, resolved?.organizationId, outletId ? null : own.organizationId);
    const place = await this.placeOf(organizationId, outletId);

    // Safe facts only, and none at all for staff data.
    let details: Record<string, unknown> | null = null;
    let phoneAt: Date | null = null;
    if (!staffData) {
      const facts: Record<string, unknown> = { ...resolved?.details };
      for (const field of meta?.facts ?? []) if (isSafeFactValue(body?.[field])) facts[field] = body?.[field];
      if (method === 'PATCH' && body) {
        const changed = Object.keys(body).filter((key) => /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(key)).slice(0, 12);
        if (changed.length > 0) facts.changed = changed;
      }
      for (const field of meta?.answerFacts ?? []) {
        const value = context.answer?.facts?.[field];
        if (typeof value === 'number') facts[field] = value;
      }
      Object.assign(facts, note.details);
      details = safeDetails(facts);
      phoneAt = phoneTimeOf(body);
    }

    const side = note.side ?? meta?.side ?? (await this.sideOfPhone(note.lookupPhone, actor));
    const source = activitySource({ role: actor?.role ?? null, client: context.client, side: side ?? null });
    const hideRecord = staffData || (kind ? STAFF_ENTITY_KINDS.includes(kind) : false);

    return this.row({
      at: context.at,
      phoneAt,
      source,
      actor,
      place,
      action,
      entity: hideRecord
        ? null
        : {
            type: note.entity?.type ?? kind ?? null,
            id: note.entity?.id ?? entityId,
            label: note.entity?.label ?? resolved?.label ?? null,
            reference: note.entity?.reference ?? resolved?.reference ?? null,
          },
      result: activityResultFor(statusCode),
      method,
      route: this.routeOf(context),
      statusCode,
      durationMs,
      details,
      ip: context.ip,
      deviceId: note.deviceId ?? user?.linkedDeviceId ?? null,
      client: context.client,
      appVersion: context.appVersion,
      requestId: context.requestId,
    });
  }

  private entityIdOf(meta: ActivityMeta, context: ActivityRequestContext, body: Record<string, unknown> | null): string | null {
    const from = meta.from ?? 'param';
    const key = meta.key ?? 'id';
    if (from === 'answer') return context.answer?.id ?? null;
    if (from === 'body') return stringOr(body?.[key]);
    return stringOr(context.params?.[key]);
  }

  /** Looks a record up before a delete removes it (started by the interceptor, never awaited there). */
  lookUpBefore(meta: ActivityMeta, context: ActivityRequestContext, body: unknown): void {
    if (!this.settings.on || !meta.entity || (meta.from ?? 'param') === 'answer') return;
    const id = this.entityIdOf(meta, context, plainObject(body));
    if (!id) return;
    context.before = this.resolve(meta.entity, id, meta.action);
  }

  private async resolve(kind: EntityKind, id: string, action: string): Promise<ResolvedEntity | null> {
    try {
      return await resolveEntity(this.db, kind, id, action);
    } catch (error) {
      this.warnOnce(`resolve:${kind}`, `Could not look up a ${kind} for the activity log: ${String(error)}`);
      return null;
    }
  }

  /**
   * The source of a one-time-code request from a phone number, when nobody is logged in:
   * the number of ECCS staff is the Supervisor's app (or the console), anyone else's the
   * restaurant app. The number itself is never stored.
   */
  private async sideOfPhone(phone: string | undefined, actor: { role: Role | null } | null): Promise<'eccs' | 'restaurant' | undefined> {
    if (!phone || actor) return undefined;
    try {
      const owner = await this.db.user.findFirst({ where: { phone }, select: { memberships: { select: { role: true } } } });
      if (!owner) return undefined;
      return owner.memberships.some((m) => isEccsRole(m.role as Role)) ? 'eccs' : 'restaurant';
    } catch {
      return undefined;
    }
  }

  /** The route's pattern, e.g. "/checklists/runs/:runId/submit", from the controller's and handler's paths. */
  private routeOf(context: ActivityRequestContext): string | null {
    const handler = context.handler;
    if (!handler) return null;
    if (this.routes.has(handler)) return this.routes.get(handler) ?? null;
    const route = routePattern(context.controller, handler);
    this.routes.set(handler, route);
    return route;
  }

  // ───────────────────────── Events and the server's own work ─────────────────────────

  /**
   * Records an event of its own, besides the request's row (a phone locked after wrong
   * PINs). Inside a request it carries that request's address, program and id.
   */
  event(action: ActivityAction, fields: ActivityEventFields = {}): void {
    if (!this.settings.on) return;
    const context = currentActivity();
    this.track(
      (async () => {
        const place = await this.placeOf(fields.organizationId ?? null, fields.outletId ?? null);
        const actor = fields.actor ?? null;
        return this.row({
          at: new Date(),
          source: activitySource({ role: actor?.role ?? null, client: context?.client ?? 'other', side: fields.side ?? null }),
          actor,
          place,
          action,
          entity: fields.entity ? { type: fields.entity.type ?? fields.entity.kind ?? null, id: fields.entity.id, label: fields.entity.label ?? null, reference: fields.entity.reference ?? null } : null,
          result: fields.result ?? 'SUCCESS',
          details: safeDetails(fields.details),
          ip: context?.ip ?? null,
          deviceId: fields.deviceId ?? null,
          client: context?.client ?? null,
          appVersion: context?.appVersion ?? null,
          requestId: context?.requestId ?? null,
        });
      })(),
    );
  }

  /**
   * Records the server's own work (source SYSTEM, no person): an invoice or certificate
   * it issued, a notification it sent. A record named by `entity.kind` is looked up for
   * its outlet, name and reference. Inside a request it carries that request's id, so
   * the Logs page can show what the server did because of it.
   */
  system(action: ActivityAction, fields: Omit<ActivityEventFields, 'actor' | 'side'> = {}): void {
    if (!this.settings.on) return;
    const context = currentActivity();
    this.track(
      (async () => {
        const entity = fields.entity;
        const resolved = entity?.kind && entity.id ? await this.resolve(entity.kind, entity.id, action) : null;
        const place = await this.placeOf(pick(fields.organizationId, resolved?.organizationId), pick(fields.outletId, resolved?.outletId));
        return this.row({
          at: new Date(),
          source: 'SYSTEM',
          actor: null,
          place,
          action,
          entity: entity
            ? {
                type: entity.type ?? entity.kind ?? null,
                id: entity.id,
                label: entity.label ?? resolved?.label ?? null,
                reference: entity.reference ?? resolved?.reference ?? null,
              }
            : null,
          result: fields.result ?? 'SUCCESS',
          details: safeDetails({ ...resolved?.details, ...fields.details }),
          requestId: context?.requestId ?? null,
        });
      })(),
    );
  }

  /**
   * One row per run of a timed job, with its counts. `quiet` jobs that run often (the
   * reminders, every quarter of an hour) are recorded only when they did something or failed.
   */
  jobRun(action: ActivityAction, counts: Record<string, number> | null, options: { error?: unknown; quiet?: boolean } = {}): void {
    const failed = options.error !== undefined;
    if (!failed && options.quiet && counts && Object.values(counts).every((value) => !value)) return;
    this.system(action, {
      result: failed ? 'FAILED' : 'SUCCESS',
      details: { ...counts, ...(failed && { error: errorName(options.error) }) },
    });
  }

  /** A notification the server sent: its kind and the roles of who was told, never its words. */
  notificationSent(kind: string, userIds: readonly string[], link: NotificationLink | null): void {
    if (!this.settings.on || userIds.length === 0 || UNLOGGED_NOTIFICATIONS.has(kind)) return;
    const context = currentActivity();
    this.track(
      (async () => {
        const memberships = await this.db.membership.findMany({ where: { userId: { in: [...userIds] } }, select: { userId: true, role: true } });
        const roles = new Set<string>();
        for (const id of new Set(userIds)) {
          const role = mainRole(memberships.filter((m) => m.userId === id).map((m) => m.role as Role));
          if (role) roles.add(role);
        }
        const entity: { kind: EntityKind; id: string } | null =
          link?.kind === 'visit' ? { kind: 'visit', id: link.visitId } : link?.kind === 'issue' ? { kind: 'issue', id: link.issueId } : null;
        const resolved = entity ? await this.resolve(entity.kind, entity.id, 'notifications.sent') : null;
        const linkOutlet = link && 'outletId' in link ? (link.outletId ?? null) : null;
        const place = await this.placeOf(resolved?.organizationId ?? null, resolved?.outletId ?? linkOutlet);
        return this.row({
          at: new Date(),
          source: 'SYSTEM',
          actor: null,
          place,
          action: 'notifications.sent',
          entity: entity ? { type: entity.kind, id: entity.id, label: resolved?.label ?? null, reference: resolved?.reference ?? null } : null,
          result: 'SUCCESS',
          details: safeDetails({ kind, people: new Set(userIds).size, roles: [...roles].sort() }),
          requestId: context?.requestId ?? null,
        });
      })(),
    );
  }

  /** Every request to the AI also writes a log row (category AI), with who and where. */
  aiRequest(request: AiActivity): void {
    if (!this.settings.on) return;
    const context = currentActivity();
    this.track(
      (async () => {
        const user = (context?.request as (Request & { user?: AuthUser }) | undefined)?.user;
        let actor: { id: string; name: string; role: Role | null } | null = null;
        if (request.userId && user?.id === request.userId) {
          actor = { id: user.id, name: user.name, role: mainRole(user.memberships.map((m) => m.role)) };
        } else if (request.userId) {
          const person = await this.db.user.findUnique({ where: { id: request.userId }, select: { id: true, name: true, memberships: { select: { role: true } } } });
          if (person) actor = { id: person.id, name: person.name, role: mainRole(person.memberships.map((m) => m.role as Role)) };
        }
        const place = await this.placeOf(request.organizationId, request.outletId);
        const source: ActivitySource = actor ? activitySource({ role: actor.role, client: context?.client ?? 'other' }) : 'SYSTEM';
        return this.row({
          at: new Date(),
          source,
          actor,
          place,
          action: AI_FEATURE_ACTIONS[request.feature],
          entity: { type: 'aiRequest', id: request.requestId, label: request.feature, reference: null },
          result: resultOfAi(request.status),
          durationMs: request.durationMs,
          details: safeDetails({
            feature: request.feature,
            model: request.model,
            status: request.status,
            inputTokens: request.inputTokens,
            outputTokens: request.outputTokens,
            errorCode: request.errorCode ?? null,
          }),
          ip: context?.ip ?? null,
          deviceId: user?.linkedDeviceId ?? null,
          client: context?.client ?? null,
          appVersion: context?.appVersion ?? null,
          requestId: context?.requestId ?? null,
          ai: { feature: request.feature, model: request.model, status: request.status, outcome: null, costMicroUsd: request.costMicroUsd },
        });
      })(),
    );
  }

  /** Later news of an AI request: the answer was refused after all, or what the person did with it. */
  aiUpdated(requestId: string, change: { status?: AiStatus; errorCode?: string; outcome?: string }): void {
    if (!this.settings.on) return;
    // The row may still be being built or waiting to be written: wait for what was started before this.
    const before = [...this.pending];
    const job = (async () => {
      await Promise.allSettled(before);
      await this.writeBuffer();
      // The AI row may be in a write the timer started a moment ago: wait for it, or the update finds nothing.
      while (this.writing.size > 0) await Promise.allSettled(this.writing);
      if (this.settings.failWrites) throw new Error('log writes are failing (test)');
      const rows = await this.db.activityLog.findMany({ where: { entityType: 'aiRequest', entityId: requestId }, select: { id: true, details: true } });
      for (const row of rows) {
        const details = { ...(row.details as Record<string, unknown> | null), ...(change.status && { status: change.status }), ...(change.errorCode && { errorCode: change.errorCode }), ...(change.outcome && { outcome: change.outcome }) };
        await this.db.activityLog.update({
          where: { id: row.id },
          data: {
            ...(change.status && { aiStatus: change.status, result: resultOfAi(change.status) }),
            ...(change.outcome && { aiOutcome: change.outcome }),
            details: safeDetails(details) as Prisma.InputJsonValue,
          },
        });
      }
    })().catch((error) => this.logger.warn(`Could not update the AI log row: ${String(error)}`));
    this.pending.add(job);
    void job.finally(() => this.pending.delete(job));
  }

  // ───────────────────────── Keeping the log a year ─────────────────────────

  /** Deletes rows older than ACTIVITY_LOG_DAYS (365) and records how many. Safe to run any number of times. */
  async prune(asOf: Date = new Date()): Promise<{ deleted: number }> {
    const cutoff = new Date(asOf.getTime() - env.ACTIVITY_LOG_DAYS * 86_400_000);
    const { count } = await this.db.activityLog.deleteMany({ where: { at: { lt: cutoff } } });
    this.jobRun('system.logs.pruned', { deleted: count, keepDays: env.ACTIVITY_LOG_DAYS });
    return { deleted: count };
  }

  // ───────────────────────── Writing ─────────────────────────

  private row(input: {
    at: Date;
    phoneAt?: Date | null;
    source: ActivitySource;
    actor: { id: string; name: string; role: Role | null } | null;
    place: Place;
    action: ActivityAction;
    entity: { type: string | null; id: string | null; label: string | null; reference: string | null } | null;
    result: ActivityResult;
    method?: string | null;
    route?: string | null;
    statusCode?: number | null;
    durationMs?: number | null;
    details: Record<string, unknown> | null;
    ip?: string | null;
    deviceId?: string | null;
    client?: ActivityClient | null;
    appVersion?: string | null;
    requestId?: string | null;
    ai?: { feature: string; model: string; status: string; outcome: string | null; costMicroUsd: number };
  }): Row {
    return {
      id: randomUUID(),
      at: input.at,
      phoneAt: input.phoneAt ?? null,
      offline: isOfflineEntry(input.at, input.phoneAt),
      source: input.source,
      actorUserId: input.actor?.id ?? null,
      actorName: input.actor ? shortText(input.actor.name) : null,
      actorRole: input.actor?.role ?? null,
      organizationId: input.place.organizationId,
      organizationName: input.place.organizationName,
      outletId: input.place.outletId,
      outletName: input.place.outletName,
      category: activityCategoryOf(input.action),
      action: input.action,
      entityType: input.entity?.type ?? null,
      entityId: input.entity?.id ?? null,
      entityLabel: input.entity?.label ? shortText(input.entity.label) : null,
      reference: input.entity?.reference ?? null,
      result: input.result,
      method: input.method ?? null,
      route: input.route ?? null,
      statusCode: input.statusCode ?? null,
      durationMs: input.durationMs ?? null,
      ...(input.details && { details: input.details as Prisma.InputJsonValue }),
      ip: input.ip ? shortText(input.ip, 64) : null,
      deviceId: input.deviceId ?? null,
      client: input.client ?? null,
      appVersion: input.appVersion ? shortText(input.appVersion, 40) : null,
      requestId: input.requestId ?? null,
      aiFeature: input.ai?.feature ?? null,
      aiModel: input.ai?.model ?? null,
      aiStatus: input.ai?.status ?? null,
      aiOutcome: input.ai?.outcome ?? null,
      aiCostMicroUsd: input.ai?.costMicroUsd ?? null,
    };
  }

  /** Keeps a row being built; when it is ready it waits a moment to be written with others. */
  private track(work: Promise<Row | null>): void {
    const job = work
      .then((row) => {
        if (!row) return;
        this.buffer.push(row);
        if (this.buffer.length >= FLUSH_AT_ROWS) void this.flush();
        else this.flushTimer ??= setTimeout(() => void this.flush(), FLUSH_AFTER_MS).unref();
      })
      .catch((error) => this.logger.warn(`Could not build an activity log row: ${String(error)}`));
    this.pending.add(job);
    void job.finally(() => this.pending.delete(job));
  }

  /**
   * Marks a request as under way; the function returned marks it finished, once its row
   * (if any) has been queued. Lets `flush()` include a request whose caller already has
   * the answer but whose "finish" event has not fired yet.
   */
  requestOpened(): () => void {
    let close!: () => void;
    const closed = new Promise<void>((resolve) => (close = resolve));
    this.open.add(closed);
    return () => {
      this.open.delete(closed);
      close();
    };
  }

  /** Writes everything built so far. Never throws; a failed write is logged and dropped. */
  async flush(): Promise<void> {
    // Requests still on their way out: wait for them a little (a request held open, such as the
    // notifications wait, must not hold this up for long).
    const open = [...this.open];
    if (open.length > 0) await Promise.race([Promise.allSettled(open), new Promise((resolve) => setTimeout(resolve, OPEN_REQUEST_WAIT_MS).unref())]);
    while (this.pending.size > 0) await Promise.allSettled(this.pending);
    await this.writeBuffer();
    // A write the timer started a moment ago may still be going: it holds rows taken off the buffer.
    while (this.writing.size > 0) await Promise.allSettled(this.writing);
  }

  private async writeBuffer(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const rows = this.buffer;
    this.buffer = [];
    if (rows.length === 0) return;
    const write = (async () => {
      try {
        if (this.settings.failWrites) throw new Error('log writes are failing (test)');
        await this.db.activityLog.createMany({ data: rows });
        this.recorded?.push(...rows.map((row) => row.id as string));
      } catch (error) {
        this.logger.warn(`Could not write ${rows.length} activity log row(s): ${String(error)}`);
      }
    })();
    this.writing.add(write);
    try {
      await write;
    } finally {
      this.writing.delete(write);
    }
  }

  /** The names of a restaurant and an outlet as they are now, kept for a minute. */
  private async placeOf(organizationId: string | null, outletId: string | null): Promise<Place> {
    const empty: Place = { organizationId, organizationName: null, outletId, outletName: null };
    if (!organizationId && !outletId) return empty;
    const key = `${organizationId ?? ''}|${outletId ?? ''}`;
    const cached = this.places.get(key);
    if (cached && cached.until > Date.now()) return cached.value;
    try {
      let value: Place;
      if (outletId) {
        const outlet = await this.db.outlet.findUnique({ where: { id: outletId }, select: { name: true, organizationId: true, organization: { select: { name: true } } } });
        value = {
          outletId,
          outletName: outlet?.name ?? null,
          organizationId: outlet?.organizationId ?? organizationId,
          organizationName: outlet?.organization.name ?? null,
        };
        if (organizationId && outlet && organizationId !== outlet.organizationId) value = { ...value, organizationId: outlet.organizationId };
      } else {
        const organization = await this.db.organization.findUnique({ where: { id: organizationId! }, select: { name: true } });
        value = { ...empty, organizationName: organization?.name ?? null };
      }
      if (this.places.size > NAME_CACHE_MAX) this.places.clear();
      this.places.set(key, { value, until: Date.now() + NAME_CACHE_MS });
      return value;
    } catch {
      return empty;
    }
  }

  private warnOnce(key: string, message: string) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.logger.warn(message);
  }

  // ───────────────────────── Tests only ─────────────────────────

  /** Tests: switch the log on or off, or make every write fail, for this run. */
  setForTest(changes: Partial<{ on: boolean; failWrites: boolean }>): void {
    if (env.NODE_ENV !== 'test') throw new Error('Activity log settings can only be changed in tests');
    this.settings = { ...this.settings, ...changes };
  }

  /** Tests: the ids of the rows written so far. */
  recordedForTest(): string[] {
    return [...(this.recorded ?? [])];
  }
}

// ───────────────────────── Small helpers ─────────────────────────

const plainObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value) ? (value as Record<string, unknown>) : null;

const stringOr = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : null);

/** The first value that is there. */
function pick<T>(...values: (T | null | undefined)[]): T | null {
  for (const value of values) if (value !== undefined && value !== null) return value;
  return null;
}

/** A restaurant user's own restaurant and, when they work at one outlet, that outlet. */
function ownPlace(user: AuthUser): { organizationId: string | null; outletId: string | null } {
  const restaurant = user.memberships.filter((m) => !isEccsRole(m.role));
  const organizations = new Set(restaurant.map((m) => m.organizationId).filter(Boolean));
  const outlets = new Set(restaurant.map((m) => m.outletId));
  const organizationId = organizations.size === 1 ? ([...organizations][0] ?? null) : null;
  const onlyOutlet = outlets.size === 1 ? ([...outlets][0] ?? null) : null;
  return { organizationId, outletId: onlyOutlet };
}

/** When the phone says the work was done, from the few body fields that carry it. */
function phoneTimeOf(body: Record<string, unknown> | null): Date | null {
  for (const field of PHONE_TIME_FIELDS) {
    const value = body?.[field];
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const time = new Date(value);
      if (!Number.isNaN(time.getTime())) return time;
    }
  }
  return null;
}

async function settle<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch {
    return null;
  }
}

/** A short name for an error, never its message (which may hold data). */
function errorName(error: unknown): string {
  return error instanceof Error ? shortText(error.name || 'Error', 40) : 'Error';
}

/** "/checklists/runs/:runId/submit" from the controller's path and the handler's. */
export function routePattern(controller: unknown, handler: object): string | null {
  const parts = (value: unknown): string[] =>
    (Array.isArray(value) ? value : [value]).filter((part): part is string => typeof part === 'string');
  const base = controller ? (parts(Reflect.getMetadata(PATH_METADATA, controller as object))[0] ?? '') : '';
  const own = parts(Reflect.getMetadata(PATH_METADATA, handler))[0] ?? '';
  const joined = `/${[base, own].map((part) => part.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/')}`;
  return joined;
}

/** The HTTP method a handler answers, from its metadata. */
export function routeMethod(handler: object): string | null {
  const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
  return method === undefined ? null : (REQUEST_METHODS[method] ?? null);
}
