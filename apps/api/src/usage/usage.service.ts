import { randomUUID } from 'node:crypto';
import { Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  addDays,
  ECCS_ROLES,
  indiaDay,
  RESTAURANT_ROLES,
  USAGE_RULES,
  USAGE_SEGMENT_ROLES,
  usageDayOf,
  usageOverview,
  usageRowsFrom,
  type Role,
  type UsageApp,
  type UsageOverviewDto,
  type UsagePersonFacts,
  type UsageQuery,
  type UsageViewsInput,
} from '@eccs/shared';
import { ActivityLogService } from '../activity-log/activity-log.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

// The Usage page (23 Oct 2026): counts the screens logged-in people open, and works out the
// page from the counts. What is kept, and why so little, is in packages/shared/src/usage.ts.

const PRUNE_FIRST_AFTER_MS = 130_000;
const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000;

const toDb = (day: string) => new Date(`${day}T00:00:00.000Z`);
const fromDb = (day: Date) => day.toISOString().slice(0, 10);
const restaurantRole = (role: Role) => (RESTAURANT_ROLES as readonly Role[]).includes(role);

/** Who a person is counted as: their restaurant role and restaurant, or their ECCS role; null for neither. */
export function usageWho(user: Pick<AuthUser, 'memberships'>): { role: Role; organizationId: string | null } | null {
  const restaurant = user.memberships.find((m) => restaurantRole(m.role) && m.organizationId);
  if (restaurant) return { role: restaurant.role, organizationId: restaurant.organizationId };
  const eccs = ECCS_ROLES.find((role) => user.memberships.some((m) => m.role === role));
  return eccs ? { role: eccs, organizationId: null } : null;
}

@Injectable()
export class UsageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UsageService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** Deletes counts past their keeping period shortly after the server starts and once a day. Off under tests. */
  onModuleInit() {
    if (env.NODE_ENV === 'test') return;
    const prune = () =>
      void this.prune()
        .then((counts) => this.activity.jobRun('system.usage.pruned', counts, { quiet: true }))
        .catch((error) => {
          this.activity.jobRun('system.usage.pruned', null, { error });
          this.logger.warn(`Could not delete old usage counts: ${String(error)}`);
        });
    const first = setTimeout(prune, PRUNE_FIRST_AFTER_MS);
    const repeat = setInterval(prune, PRUNE_EVERY_MS);
    first.unref();
    repeat.unref();
    this.timers = [first, repeat];
  }

  onModuleDestroy() {
    for (const timer of this.timers) clearTimeout(timer);
  }

  /** Deletes every count older than USAGE_RULES.keepDays. Safe to run any number of times. */
  async prune(asOf: Date = new Date()): Promise<{ deleted: number }> {
    const oldest = addDays(indiaDay(asOf), -(USAGE_RULES.keepDays - 1));
    const { count } = await this.db.usageDay.deleteMany({ where: { day: { lt: toDb(oldest) } } });
    return { deleted: count };
  }

  /**
   * Adds the screens a person opened to their counts: one row per day, app and screen, one
   * more for each open. Someone with neither a restaurant role nor an ECCS one is not counted.
   */
  async record(user: AuthUser, input: UsageViewsInput, receivedAt: Date = new Date()): Promise<{ counted: number }> {
    const who = usageWho(user);
    if (!who) return { counted: 0 };
    const app = input.app as UsageApp;
    const groups = new Map<string, { day: string; screen: string; views: number; firstAt: Date; lastAt: Date }>();
    for (const view of input.views) {
      const at = usageDayOf(view.at, receivedAt);
      const day = indiaDay(at);
      const key = `${day}|${user.id}|${app}|${view.screen}`;
      const group = groups.get(key);
      if (group) {
        group.views += 1;
        if (at < group.firstAt) group.firstAt = at;
        if (at > group.lastAt) group.lastAt = at;
      } else groups.set(key, { day, screen: view.screen, views: 1, firstAt: at, lastAt: at });
    }
    // One statement per row, so two batches arriving together both count.
    for (const [key, group] of groups) {
      await this.db.$executeRaw`
        INSERT INTO "UsageDay" ("id", "key", "day", "userId", "role", "organizationId", "app", "screen", "views", "firstAt", "lastAt")
        VALUES (${randomUUID()}, ${key}, ${group.day}::date, ${user.id}, ${who.role}::"Role", ${who.organizationId}, ${app}, ${group.screen}, ${group.views}, ${group.firstAt}, ${group.lastAt})
        ON CONFLICT ("key") DO UPDATE SET
          "views" = "UsageDay"."views" + EXCLUDED."views",
          "firstAt" = LEAST("UsageDay"."firstAt", EXCLUDED."firstAt"),
          "lastAt" = GREATEST("UsageDay"."lastAt", EXCLUDED."lastAt")`;
    }
    return { counted: input.views.length };
  }

  /** Everything on the Usage page for a period, for the restaurants' logins or for ECCS's team. */
  async overview(query: UsageQuery, today: string = indiaDay(new Date())): Promise<UsageOverviewDto> {
    const roles = [...USAGE_SEGMENT_ROLES[query.segment]];
    const restaurantId = query.segment === 'restaurants' ? (query.restaurant ?? null) : null;
    const organizations = await this.db.organization.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    const chosen = restaurantId ? organizations.find((organization) => organization.id === restaurantId) : null;
    if (restaurantId && !chosen) throw new NotFoundException('No such restaurant');

    const [rows, logins] = await Promise.all([
      this.db.usageDay.findMany({
        where: { day: { gte: toDb(usageRowsFrom(today, query.days)) }, role: { in: roles }, ...(restaurantId && { organizationId: restaurantId }) },
        select: { day: true, userId: true, role: true, organizationId: true, app: true, screen: true, views: true },
      }),
      this.db.membership.findMany({
        where: {
          role: { in: roles },
          user: { isActive: true },
          // ECCS's team: those still on it (not marked as left); restaurants: their open accounts.
          ...(query.segment === 'team' ? { user: { isActive: true, OR: [{ teamMember: null }, { teamMember: { leftOn: null } }] } } : { organization: { isActive: true } }),
          ...(restaurantId && { organizationId: restaurantId }),
        },
        select: { role: true, organizationId: true, user: { select: { id: true, name: true } } },
      }),
    ]);

    // One person once, with the first role found (a person with two restaurant roles is rare).
    const people = new Map<string, UsagePersonFacts>();
    for (const login of logins) {
      if (!people.has(login.user.id)) people.set(login.user.id, { id: login.user.id, name: login.user.name, role: login.role, organizationId: query.segment === 'team' ? null : login.organizationId, lastActiveOn: null });
    }
    const userIds = [...people.keys()];
    const [lastByUser, lastByOrg] = await Promise.all([
      userIds.length ? this.db.usageDay.groupBy({ by: ['userId'], where: { userId: { in: userIds } }, _max: { day: true } }) : Promise.resolve([]),
      query.segment === 'restaurants' ? this.db.usageDay.groupBy({ by: ['organizationId'], where: { organizationId: { not: null }, role: { in: roles } }, _max: { day: true } }) : Promise.resolve([]),
    ]);
    for (const last of lastByUser) {
      const person = people.get(last.userId);
      if (person && last._max.day) person.lastActiveOn = fromDb(last._max.day);
    }
    const orgLast = new Map(lastByOrg.map((last) => [last.organizationId, last._max.day ? fromDb(last._max.day) : null]));

    const view = usageOverview({
      rows: rows.map((row) => ({ ...row, day: fromDb(row.day), app: row.app as UsageApp })),
      people: [...people.values()],
      restaurants: organizations.map((organization) => ({ id: organization.id, name: organization.name, lastActiveOn: orgLast.get(organization.id) ?? null })),
      today,
      days: query.days,
      segment: query.segment,
      restaurantId,
    });
    return {
      ...view,
      segment: query.segment,
      restaurant: chosen ? { id: chosen.id, name: chosen.name } : null,
      restaurantChoices: organizations,
      keepDays: USAGE_RULES.keepDays,
    };
  }
}
