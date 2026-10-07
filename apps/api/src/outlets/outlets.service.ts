import { Injectable } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import { accessScope, can, type OutletSummaryDto } from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class OutletsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Outlets the user may see: all, those with jobs assigned to them, or their own. */
  async listFor(user: AuthUser): Promise<OutletSummaryDto[]> {
    const scope = accessScope(user.memberships, 'clients');
    if (!scope) return [];

    let where: Prisma.OutletWhereInput;
    if (scope.kind === 'all') {
      where = {};
    } else if (scope.kind === 'assigned') {
      where = { jobs: { some: { supervisorId: user.id } } };
    } else {
      where = { OR: [{ organizationId: { in: scope.organizationIds } }, { id: { in: scope.outletIds } }] };
    }

    const outlets = await this.prisma.client.outlet.findMany({
      // Outlets ECCS has switched off, and those of a client that is switched off, are left out for everyone.
      where: { ...where, isActive: true, organization: { isActive: true } },
      select: {
        id: true,
        name: true,
        address: true,
        city: true,
        code: true,
        organization: { select: { id: true, name: true } },
      },
      orderBy: [{ organization: { name: 'asc' } }, { name: 'asc' }],
    });

    // The restaurant code lets a phone reach the PIN pad, so it only goes to
    // the people who add staff there.
    return outlets.map((outlet) => ({
      ...outlet,
      code: can(user.memberships, 'restaurantUsers', 'create', {
        organizationId: outlet.organization.id,
        outletId: outlet.id,
      })
        ? outlet.code
        : null,
    }));
  }
}
