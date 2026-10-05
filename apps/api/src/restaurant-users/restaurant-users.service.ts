import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  accessScope,
  can,
  type Language,
  type RestaurantUserDto,
  type RestaurantUserWithPinDto,
  type Role,
} from '@eccs/shared';
import { AuthService } from '../auth/auth.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

const RESTAURANT_ROLES: Role[] = ['OWNER', 'MANAGER', 'HEAD_CHEF'];

const membershipInclude = { user: true, outlet: { select: { name: true } } } as const;
type MembershipRow = Prisma.MembershipGetPayload<{ include: typeof membershipInclude }>;

/** Logins for restaurant staff. The Owner or a Manager adds a person and is shown their PIN once. */
@Injectable()
export class RestaurantUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  async list(actor: AuthUser): Promise<RestaurantUserDto[]> {
    const scope = accessScope(actor.memberships, 'restaurantUsers');
    if (!scope) return [];

    let where: Prisma.MembershipWhereInput;
    if (scope.kind === 'all') {
      where = {};
    } else if (scope.kind === 'assigned') {
      where = { outlet: { jobs: { some: { supervisorId: actor.id } } } };
    } else {
      where = { OR: [{ organizationId: { in: scope.organizationIds } }, { outletId: { in: scope.outletIds } }] };
    }

    const rows = await this.db.membership.findMany({
      where: { ...where, role: { in: RESTAURANT_ROLES } },
      include: membershipInclude,
      orderBy: [{ role: 'asc' }, { user: { name: 'asc' } }],
    });
    return rows.map(toDto);
  }

  async create(
    actor: AuthUser,
    input: { name: string; role: 'MANAGER' | 'HEAD_CHEF'; outletId: string; language?: Language | undefined },
  ): Promise<RestaurantUserWithPinDto> {
    const outlet = await this.db.outlet.findFirst({ where: { id: input.outletId, isActive: true } });
    // Same answer for "does not exist" and "not yours", so outlet ids cannot be probed.
    if (!outlet || !this.mayManage(actor, 'create', input.role, outlet.organizationId, outlet.id)) {
      throw new ForbiddenException('You cannot add this role at this outlet');
    }

    const membership = await this.db.membership.create({
      data: {
        role: input.role,
        organization: { connect: { id: outlet.organizationId } },
        outlet: { connect: { id: outlet.id } },
        user: { create: { name: input.name, language: input.language ?? 'EN' } },
      },
      include: membershipInclude,
    });
    const pin = await this.auth.assignPin(membership.userId, outlet.organizationId);
    return { user: toDto(membership), pin };
  }

  /** Replaces a person's PIN and logs them out everywhere. */
  async resetPin(actor: AuthUser, userId: string): Promise<RestaurantUserWithPinDto> {
    const membership = await this.findManageable(actor, userId);
    const pin = await this.auth.assignPin(userId, membership.organizationId!);
    await this.auth.revokeSessions(userId);
    return { user: toDto(membership), pin };
  }

  async update(
    actor: AuthUser,
    userId: string,
    input: { name?: string | undefined; language?: Language | undefined; isActive?: boolean | undefined },
  ): Promise<RestaurantUserDto> {
    const membership = await this.findManageable(actor, userId);
    if (input.isActive === false && userId === actor.id) {
      throw new ForbiddenException('You cannot deactivate yourself');
    }

    const user = await this.db.user.update({
      where: { id: userId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.language !== undefined && { language: input.language }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        // A deactivated person's PIN is freed and stops working at once.
        ...(input.isActive === false && { pinLookup: null }),
      },
    });
    if (input.isActive === false) {
      await this.auth.revokeSessions(userId);
    }
    return toDto({ ...membership, user });
  }

  private async findManageable(actor: AuthUser, userId: string): Promise<MembershipRow> {
    const membership = await this.db.membership.findFirst({
      where: { userId, role: { in: RESTAURANT_ROLES } },
      include: membershipInclude,
    });
    if (
      !membership?.organizationId ||
      !this.mayManage(actor, 'update', membership.role, membership.organizationId, membership.outletId)
    ) {
      throw new NotFoundException('Person not found');
    }
    return membership;
  }

  /**
   * ECCS admins and the Owner manage Managers and Head Chefs; a Manager
   * manages Head Chefs at their own outlet. An Owner's login is created by
   * ECCS at onboarding and reset by the Owner's own one-time code.
   */
  private mayManage(
    actor: AuthUser,
    action: 'create' | 'update',
    targetRole: Role,
    organizationId: string,
    outletId: string | null,
  ): boolean {
    if (targetRole === 'OWNER') return false;
    if (!can(actor.memberships, 'restaurantUsers', action, { organizationId, outletId })) return false;
    if (targetRole === 'HEAD_CHEF') return true;
    // Reaching here with only a MANAGER membership means a Manager is trying to manage a Manager.
    return actor.memberships.some(
      (m) =>
        m.role === 'SUPER_ADMIN' ||
        m.role === 'OPS_MANAGER' ||
        (m.role === 'OWNER' && m.organizationId === organizationId),
    );
  }
}

function toDto(row: MembershipRow): RestaurantUserDto {
  return {
    id: row.user.id,
    name: row.user.name,
    language: row.user.language,
    isActive: row.user.isActive,
    role: row.role,
    organizationId: row.organizationId ?? '',
    outletId: row.outletId,
    outletName: row.outlet?.name ?? null,
  };
}
