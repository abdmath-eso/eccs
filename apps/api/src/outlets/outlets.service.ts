import { Injectable } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import { accessScope } from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class OutletsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Outlets the user may see: all, those with jobs assigned to them, or their own. */
  async listFor(user: AuthUser) {
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

    return this.prisma.client.outlet.findMany({
      where: { ...where, isActive: true },
      select: {
        id: true,
        name: true,
        address: true,
        city: true,
        organization: { select: { id: true, name: true } },
      },
      orderBy: [{ organization: { name: 'asc' } }, { name: 'asc' }],
    });
  }
}
