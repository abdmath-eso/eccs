import { SetMetadata } from '@nestjs/common';
import type { ActivityAction } from '@eccs/shared';
import type { EntityKind } from './activity-entities.js';

export const ACTIVITY_META = 'activity:meta';

/** How a route is recorded in the activity log. Everything is optional. */
export interface ActivityOptions {
  /**
   * The kind of record the request is about. Its outlet, restaurant, short name and
   * reference are looked up after the answer has gone (before, for a delete).
   */
  entity?: EntityKind;
  /** Where the record's id is: a route parameter (the default), a body field, or the answer's `id`. */
  from?: 'param' | 'body' | 'answer';
  /** The parameter, body field or answer field holding the id ("id" unless said; a path such as "user.id" for the answer). */
  key?: string;
  /**
   * Body fields kept as facts. Only short codes (letters, digits, "_", "-"), numbers and
   * true or false pass; free text never does (see `isSafeFactValue`).
   */
  facts?: readonly string[];
  /** Numbers kept from the answer, e.g. how many visits were created. */
  answerFacts?: readonly string[];
  /**
   * Staff, attendance, pay and face actions: only the action, the restaurant, the outlet
   * and who did it are kept. No record id or name, no facts, no changed fields, no times.
   */
  staffData?: true;
  /**
   * For reading (GET) routes, which are not recorded unless they say so: "failures"
   * records only refusals and errors; "noted" only when the handler calls
   * noteActivity({ record: true }); "always" every call.
   */
  reads?: 'always' | 'failures' | 'noted';
  /** Never recorded, with the reason (clock-ins, clock-outs and face scans). */
  never?: string;
  /** With nobody logged in: the restaurant app (PIN screens) or the public pages. */
  side?: 'restaurant' | 'public';
  /**
   * False when an outletId in the request is a filter rather than where it happened
   * (the Logs page's own export), so the row is not put under that outlet.
   */
  place?: false;
}

export interface ActivityMeta extends ActivityOptions {
  action: ActivityAction;
}

/**
 * The action key every route that changes something must carry, so that nothing goes
 * unrecorded: a test lists every POST, PUT, PATCH and DELETE route and fails on one
 * without it (activity-log.e2e-spec.ts). The label shown on the Logs page comes from
 * ACTIVITY_ACTIONS in packages/shared/src/activity-log.ts, where a new key is added.
 */
export const Activity = (action: ActivityAction, options: ActivityOptions = {}) =>
  SetMetadata(ACTIVITY_META, { action, ...options } satisfies ActivityMeta);
