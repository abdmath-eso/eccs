import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  ACTIVITY_ENTITY_LABELS,
  ACTIVITY_FAILURE_RESULTS,
  ACTIVITY_LOG_RULES,
  ACTIVITY_RESULT_LABELS,
  ACTIVITY_SOURCE_LABELS,
  ROLE_LABELS,
  actionsMatching,
  activityActionLabel,
  activityCategoryLabel,
  activityCategoryOf,
  type ActivityClient,
  type ActivityDetails,
  type ActivityFacetOption,
  type ActivityLogEntryDto,
  type ActivityLogEventDto,
  type ActivityLogFacetsDto,
  type ActivityLogPageDto,
  type ActivityLogQuery,
  type ActivityLogSummaryDto,
  type ActivityResult,
  type ActivitySource,
  type Role,
} from '@eccs/shared';
import { PrismaService } from '../prisma/prisma.service.js';

// Reading the activity log for the console's Logs page: the list (newest first, a page
// at a time), the choices for the filter menus with their counts, a summary, one event
// in full, and a CSV export. Only the Super Admin and the Ops Manager reach any of it
// (the controller checks the auditLog grant).

type Row = Prisma.ActivityLogGetPayload<object>;
type Where = Prisma.ActivityLogWhereInput;

/** The filters a facet can leave out, so its own menu still shows the other choices. */
type Dimension =
  | 'source'
  | 'result'
  | 'category'
  | 'action'
  | 'role'
  | 'organizationId'
  | 'outletId'
  | 'actorUserId'
  | 'client'
  | 'entityType'
  | 'aiFeature'
  | 'aiModel'
  | 'aiStatus'
  | 'aiOutcome';

/** The most choices in a long menu (people, outlets, actions). */
const FACET_MAX = 200;

const usd = (micro: number) => Math.round(micro) / 1_000_000;

@Injectable()
export class ActivityLogReaderService {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  // ───────────────────────── Filters ─────────────────────────

  /** Every filter of the query, all combined; `leaveOut` drops one, for that facet's own menu. */
  where(query: ActivityLogQuery, leaveOut?: Dimension): Where {
    const and: Where[] = [];
    const has = (dimension: Dimension) => dimension !== leaveOut;
    if (query.from || query.to) and.push({ at: { ...(query.from && { gte: query.from }), ...(query.to && { lte: query.to }) } });
    if (query.source && has('source')) and.push({ source: { in: query.source } });
    if (query.organizationId && has('organizationId')) and.push({ organizationId: { in: query.organizationId } });
    if (query.outletId && has('outletId')) and.push({ outletId: { in: query.outletId } });
    if (query.actorUserId && has('actorUserId')) and.push({ actorUserId: { in: query.actorUserId } });
    if (query.role && has('role')) and.push({ actorRole: { in: query.role } });
    if (query.category && has('category')) and.push({ category: { in: query.category } });
    if (query.action && has('action')) and.push({ action: { in: query.action } });
    if (has('result')) {
      if (query.result) and.push({ result: { in: query.result } });
      if (query.failuresOnly) and.push({ result: { in: [...ACTIVITY_FAILURE_RESULTS] } });
    }
    if (query.entityType && has('entityType')) and.push({ entityType: query.entityType });
    if (query.entityId) and.push({ entityId: query.entityId });
    if (query.reference) and.push({ reference: { equals: query.reference, mode: 'insensitive' } });
    if (query.ip) and.push({ ip: query.ip });
    if (query.deviceId) and.push({ deviceId: query.deviceId });
    if (query.client && has('client')) and.push({ client: { in: query.client } });
    if (query.requestId) and.push({ requestId: query.requestId });
    if (query.offline) and.push({ offline: true });
    if (query.aiFeature && has('aiFeature')) and.push({ aiFeature: { in: query.aiFeature } });
    if (query.aiModel && has('aiModel')) and.push({ aiModel: { in: query.aiModel } });
    if (query.aiStatus && has('aiStatus')) and.push({ aiStatus: { in: query.aiStatus } });
    if (query.aiOutcome && has('aiOutcome')) and.push({ aiOutcome: { in: query.aiOutcome } });
    if (query.q) {
      const words = query.q;
      const contains = { contains: words, mode: 'insensitive' as const };
      const actions = actionsMatching(words);
      and.push({
        OR: [
          { actorName: contains },
          { organizationName: contains },
          { outletName: contains },
          { entityLabel: contains },
          { reference: contains },
          ...(actions.length > 0 ? [{ action: { in: actions } }] : []),
          { entityId: words },
          { requestId: words },
        ],
      });
    }
    return and.length > 0 ? { AND: and } : {};
  }

  // ───────────────────────── The list ─────────────────────────

  async list(query: ActivityLogQuery): Promise<ActivityLogPageDto> {
    const limit = query.limit ?? ACTIVITY_LOG_RULES.pageSize;
    const after = decodeCursor(query.cursor);
    const where: Where = after
      ? { AND: [this.where(query), { OR: [{ at: { lt: after.at } }, { at: after.at, id: { lt: after.id } }] }] }
      : this.where(query);
    const rows = await this.db.activityLog.findMany({ where, orderBy: [{ at: 'desc' }, { id: 'desc' }], take: limit + 1 });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return { entries: page.map(toEntry), nextCursor: rows.length > limit && last ? encodeCursor(last) : null };
  }

  /** One event in full, with the other rows written for the same request. */
  async get(id: string): Promise<ActivityLogEventDto> {
    const row = await this.db.activityLog.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('That log entry was not found');
    const related = row.requestId
      ? await this.db.activityLog.findMany({ where: { requestId: row.requestId, id: { not: row.id } }, orderBy: [{ at: 'asc' }, { id: 'asc' }], take: 50 })
      : [];
    return { ...toEntry(row), related: related.map(toEntry) };
  }

  // ───────────────────────── Filter menus ─────────────────────────

  /**
   * The choices for each filter menu with how many rows have each, counted under all
   * the other filters (a menu does not narrow itself), the most frequent first.
   */
  async facets(query: ActivityLogQuery): Promise<ActivityLogFacetsDto> {
    // Columns every row has need no "not empty" condition (Prisma refuses one on them).
    const required = new Set<keyof Row>(['source', 'result', 'category', 'action']);
    const simple = async (dimension: Dimension, column: keyof Row, label: (value: string) => string): Promise<ActivityFacetOption[]> => {
      const groups = (await this.db.activityLog.groupBy({
        by: [column as Prisma.ActivityLogScalarFieldEnum],
        where: required.has(column) ? this.where(query, dimension) : { AND: [this.where(query, dimension), { [column]: { not: null } }] },
        _count: { _all: true },
      })) as unknown as ({ _count: { _all: number } } & Record<string, unknown>)[];
      return groups
        .map((group) => {
          const value = String(group[column]);
          return { value, label: label(value), count: group._count._all };
        })
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
        .slice(0, FACET_MAX);
    };
    const plain = (value: string) => value;

    const [sources, results, categories, actionGroups, roles, clients, entityTypes, aiFeatures, aiModels, aiStatuses, aiOutcomes, organizations, outlets, people] =
      await Promise.all([
        simple('source', 'source', (value) => ACTIVITY_SOURCE_LABELS[value as ActivitySource] ?? value),
        simple('result', 'result', (value) => ACTIVITY_RESULT_LABELS[value as ActivityResult] ?? value),
        simple('category', 'category', activityCategoryLabel),
        simple('action', 'action', activityActionLabel),
        simple('role', 'actorRole', (value) => ROLE_LABELS[value as Role] ?? value),
        simple('client', 'client', plain),
        simple('entityType', 'entityType', (value) => ACTIVITY_ENTITY_LABELS[value] ?? value),
        simple('aiFeature', 'aiFeature', plain),
        simple('aiModel', 'aiModel', plain),
        simple('aiStatus', 'aiStatus', plain),
        simple('aiOutcome', 'aiOutcome', plain),
        this.named(query, 'organizationId', ['organizationId', 'organizationName']),
        this.named(query, 'outletId', ['outletId', 'outletName', 'organizationId', 'organizationName']),
        this.named(query, 'actorUserId', ['actorUserId', 'actorName', 'actorRole']),
      ]);

    return {
      sources,
      results,
      categories,
      actions: actionGroups.map((option) => ({ ...option, category: activityCategoryOf(option.value) })),
      roles,
      organizations: organizations.map(({ value, label, count }) => ({ value, label, count })),
      outlets: outlets.map(({ value, label, count, extra }) => ({
        value,
        label,
        count,
        organizationId: extra.organizationId ?? null,
        organizationName: extra.organizationName ?? null,
      })),
      people: people.map(({ value, label, count, extra }) => ({ value, label, count, role: (extra.actorRole as Role | null) ?? null })),
      clients,
      entityTypes,
      aiFeatures,
      aiModels,
      aiStatuses,
      aiOutcomes,
    };
  }

  /**
   * A menu of things with names (restaurants, outlets, people). Names are copied into
   * each row, so one id can carry an old and a new name: the name on most rows is shown.
   */
  private async named(
    query: ActivityLogQuery,
    dimension: 'organizationId' | 'outletId' | 'actorUserId',
    columns: (keyof Row)[],
  ): Promise<{ value: string; label: string; count: number; extra: Record<string, string | null> }[]> {
    const [idColumn, nameColumn] = columns as [keyof Row, keyof Row];
    const groups = (await this.db.activityLog.groupBy({
      by: columns as Prisma.ActivityLogScalarFieldEnum[],
      where: { AND: [this.where(query, dimension), { [idColumn]: { not: null } }] },
      _count: { _all: true },
    })) as unknown as ({ _count: { _all: number } } & Record<string, unknown>)[];
    const byId = new Map<string, { value: string; label: string; count: number; best: number; extra: Record<string, string | null> }>();
    for (const group of groups) {
      const id = String(group[idColumn]);
      const count = group._count._all;
      const name = (group[nameColumn] as string | null) ?? null;
      const extra = Object.fromEntries(columns.slice(2).map((column) => [column, (group[column] as string | null) ?? null]));
      const seen = byId.get(id);
      if (!seen) byId.set(id, { value: id, label: name ?? 'Unknown', count, best: count, extra });
      else {
        seen.count += count;
        if (count > seen.best && name) Object.assign(seen, { label: name, best: count, extra });
      }
    }
    return [...byId.values()]
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, FACET_MAX)
      .map(({ value, label, count, extra }) => ({ value, label, count, extra }));
  }

  // ───────────────────────── Summary ─────────────────────────

  async summary(query: ActivityLogQuery): Promise<ActivityLogSummaryDto> {
    const where = this.where(query);
    const distinct = async (column: 'actorUserId' | 'organizationId' | 'outletId') =>
      (await this.db.activityLog.groupBy({ by: [column], where: { AND: [where, { [column]: { not: null } }] } })).length;
    const [events, byResult, people, organizations, outlets, offline, ai] = await Promise.all([
      this.db.activityLog.count({ where }),
      this.db.activityLog.groupBy({ by: ['result'], where, _count: { _all: true } }),
      distinct('actorUserId'),
      distinct('organizationId'),
      distinct('outletId'),
      this.db.activityLog.count({ where: { AND: [where, { offline: true }] } }),
      this.db.activityLog.aggregate({ where: { AND: [where, { aiFeature: { not: null } }] }, _count: { _all: true }, _sum: { aiCostMicroUsd: true } }),
    ]);
    const count = (result: ActivityResult) => byResult.find((group) => group.result === result)?._count._all ?? 0;
    const refused = count('REFUSED');
    const rejected = count('REJECTED');
    const failed = count('FAILED');
    return {
      events,
      failures: refused + rejected + failed,
      refused,
      rejected,
      failed,
      people,
      organizations,
      outlets,
      offline,
      aiCalls: ai._count._all,
      aiCostUsd: usd(ai._sum.aiCostMicroUsd ?? 0),
    };
  }

  // ───────────────────────── Export ─────────────────────────

  /** The rows of the current filters as CSV, newest first, at most 10,000. */
  async exportCsv(query: ActivityLogQuery): Promise<{ csv: string; rows: number; truncated: boolean }> {
    const max = ACTIVITY_LOG_RULES.exportMax;
    const rows = await this.db.activityLog.findMany({ where: this.where(query), orderBy: [{ at: 'desc' }, { id: 'desc' }], take: max + 1 });
    const kept = rows.slice(0, max).map(toEntry);
    const lines = [CSV_COLUMNS.map(([title]) => title), ...kept.map((entry) => CSV_COLUMNS.map(([, value]) => value(entry)))];
    // The byte-order mark lets Excel read names written in Indian scripts correctly.
    const csv = `﻿${lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n')}\r\n`;
    return { csv, rows: kept.length, truncated: rows.length > max };
  }
}

// ───────────────────────── Shapes ─────────────────────────

export function toEntry(row: Row): ActivityLogEntryDto {
  const role = (row.actorRole as Role | null) ?? null;
  return {
    id: row.id,
    at: row.at.toISOString(),
    phoneAt: row.phoneAt?.toISOString() ?? null,
    offline: row.offline,
    source: row.source as ActivitySource,
    sourceLabel: ACTIVITY_SOURCE_LABELS[row.source as ActivitySource] ?? row.source,
    actorUserId: row.actorUserId,
    actorName: row.actorName,
    actorRole: role,
    actorRoleLabel: role ? (ROLE_LABELS[role] ?? role) : null,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    outletId: row.outletId,
    outletName: row.outletName,
    category: row.category,
    categoryLabel: activityCategoryLabel(row.category),
    action: row.action,
    actionLabel: activityActionLabel(row.action),
    entityType: row.entityType,
    entityId: row.entityId,
    entityLabel: row.entityLabel,
    reference: row.reference,
    result: row.result as ActivityResult,
    resultLabel: ACTIVITY_RESULT_LABELS[row.result as ActivityResult] ?? row.result,
    method: row.method,
    route: row.route,
    statusCode: row.statusCode,
    durationMs: row.durationMs,
    details: (row.details as ActivityDetails | null) ?? null,
    ip: row.ip,
    deviceId: row.deviceId,
    client: (row.client as ActivityClient | null) ?? null,
    appVersion: row.appVersion,
    requestId: row.requestId,
    ai: row.aiFeature
      ? { feature: row.aiFeature, model: row.aiModel, status: row.aiStatus, outcome: row.aiOutcome, costUsd: usd(row.aiCostMicroUsd ?? 0) }
      : null,
  };
}

const encodeCursor = (row: Row) => Buffer.from(`${row.at.toISOString()}|${row.id}`).toString('base64url');

function decodeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const time = at ? new Date(at) : null;
  return time && !Number.isNaN(time.getTime()) && id ? { at: time, id } : null;
}

/** India time for people reading the export, e.g. "15 Oct 2026, 10:42:07". */
const indiaTime = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(iso));

const CSV_COLUMNS: [string, (entry: ActivityLogEntryDto) => string | number | boolean | null][] = [
  ['Time (India)', (entry) => indiaTime(entry.at)],
  ['Time (UTC)', (entry) => entry.at],
  ['Source', (entry) => entry.sourceLabel],
  ['Person', (entry) => entry.actorName],
  ['Role', (entry) => entry.actorRoleLabel],
  ['Restaurant', (entry) => entry.organizationName],
  ['Outlet', (entry) => entry.outletName],
  ['Area', (entry) => entry.categoryLabel],
  ['What', (entry) => entry.actionLabel],
  ['Action key', (entry) => entry.action],
  ['Record', (entry) => (entry.entityType ? (ACTIVITY_ENTITY_LABELS[entry.entityType] ?? entry.entityType) : null)],
  ['Record name', (entry) => entry.entityLabel],
  ['Reference', (entry) => entry.reference],
  ['Result', (entry) => entry.resultLabel],
  ['Status code', (entry) => entry.statusCode],
  ['Method', (entry) => entry.method],
  ['Route', (entry) => entry.route],
  ['Time taken (ms)', (entry) => entry.durationMs],
  ['Phone time', (entry) => entry.phoneAt],
  ['Done offline', (entry) => (entry.offline ? 'yes' : '')],
  ['AI feature', (entry) => entry.ai?.feature ?? null],
  ['AI model', (entry) => entry.ai?.model ?? null],
  ['AI status', (entry) => entry.ai?.status ?? null],
  ['AI outcome', (entry) => entry.ai?.outcome ?? null],
  ['AI cost (USD)', (entry) => entry.ai?.costUsd ?? null],
  ['Details', (entry) => (entry.details ? JSON.stringify(entry.details) : null)],
  ['IP address', (entry) => entry.ip],
  ['Phone (linked device)', (entry) => entry.deviceId],
  ['Program', (entry) => entry.client],
  ['App version', (entry) => entry.appVersion],
  ['Request id', (entry) => entry.requestId],
  ['Entry id', (entry) => entry.id],
];

/**
 * One CSV cell. A value starting with =, +, -, @ or a tab could run as a formula when
 * the file is opened in a spreadsheet, so it gets a leading apostrophe (OWASP, "CSV
 * Injection"). Quotes are doubled and the cell quoted when needed.
 */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
