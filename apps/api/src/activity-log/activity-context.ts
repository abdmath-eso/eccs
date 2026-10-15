import { AsyncLocalStorage } from 'node:async_hooks';
import type { ExecutionContext } from '@nestjs/common';
import type { ActivityAction, ActivityClient, Role } from '@eccs/shared';
import type { Request } from 'express';

// The request's own scratch pad for the activity log. The middleware opens one for
// every request; AuthGuard says which handler it reached; services add safe facts
// with `noteActivity`; and after the answer has gone, the log row is written from it
// (ActivityLogService). Nothing here is ever sent anywhere, and only what the writer
// picks out of it is stored.

/** What a service can add to the log row of the request it is serving. All optional. */
export interface ActivityNote {
  /** A more exact action than the route's own, e.g. "auth.pin.wrong" instead of "auth.pin.login". */
  action?: ActivityAction;
  /** The person, when the request had no login yet (a successful login). */
  actor?: { id: string; name: string; role: Role | null };
  organizationId?: string | null;
  outletId?: string | null;
  /** The linked phone (LinkedDevice id). */
  deviceId?: string | null;
  /** The record it was about, with a short safe name and its reference. */
  entity?: { type: string; id: string | null; label?: string | null; reference?: string | null };
  /** Safe facts only (a status, a count): they pass through `safeDetails` before being stored. */
  details?: Record<string, unknown>;
  /** Without a login, which side the request is from (see `activitySource`). */
  side?: 'restaurant' | 'eccs' | 'public';
  /**
   * Kept in memory only and never stored: a phone number whose owner decides the source
   * of a one-time-code request (an ECCS staff number on the phone is the Supervisor's app).
   */
  lookupPhone?: string;
  /** For a reading route whose rows are written only when the handler says so. */
  record?: true;
}

/** What is known about the request while it runs. */
export interface ActivityRequestContext {
  /** The request itself, so the person AuthGuard attaches can be read later (by the AI row). */
  request?: Request;
  requestId: string;
  at: Date;
  startedAt: number;
  method: string;
  ip: string | null;
  client: ActivityClient;
  appVersion: string | null;
  /** The handler and its controller, from AuthGuard (the first guard), so even a refused request has its action. */
  handler?: (...args: unknown[]) => unknown;
  controller?: abstract new (...args: never[]) => unknown;
  /** The route's parameters, kept when the handler was reached. */
  params?: Record<string, string>;
  note: ActivityNote;
  /** From the handler's answer: the new record's id and the counts it carries. */
  answer?: { id?: string; facts?: Record<string, number> };
  /** The record looked up before a delete removes it. */
  before?: Promise<unknown>;
}

const storage = new AsyncLocalStorage<ActivityRequestContext>();
const ON_REQUEST = Symbol('eccs.activity');

type WithActivity = Request & { [ON_REQUEST]?: ActivityRequestContext };

/** Runs the rest of the request inside its own context. */
export function runWithActivity(request: Request, context: ActivityRequestContext, next: () => void): void {
  (request as WithActivity)[ON_REQUEST] = context;
  context.request = request;
  storage.run(context, next);
}

/** The context of the request being served now, if any (none in timers and at start-up). */
export function currentActivity(): ActivityRequestContext | undefined {
  return storage.getStore();
}

export function activityOf(request: Request): ActivityRequestContext | undefined {
  return (request as WithActivity)[ON_REQUEST];
}

/**
 * Adds safe facts to the log row of the request being served. Never throws, and does
 * nothing outside a request. Details are merged; the rest replaces what was noted before.
 */
export function noteActivity(note: ActivityNote): void {
  const context = storage.getStore();
  if (!context) return;
  const { details, ...rest } = note;
  context.note = { ...context.note, ...rest, ...(details && { details: { ...context.note.details, ...details } }) };
}

/**
 * Called first thing by AuthGuard: which handler the request reached. Guards run
 * before anything can refuse the request, so a refused one still has its action.
 */
export function noteActivityHandler(execution: ExecutionContext): void {
  try {
    const request = execution.switchToHttp().getRequest<Request>();
    const context = activityOf(request);
    if (!context) return;
    context.handler = execution.getHandler() as ActivityRequestContext['handler'];
    context.controller = execution.getClass() as ActivityRequestContext['controller'];
    context.params = { ...(request.params as Record<string, string>) };
  } catch {
    // The log never stands in the way of a request.
  }
}
