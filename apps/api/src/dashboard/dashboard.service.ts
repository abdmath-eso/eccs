import { Injectable } from '@nestjs/common';
import { accessScope, can, type OutletDashboardDto } from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { ChecklistsService, indiaDate } from '../checklists/checklists.service.js';
import { IssuesService } from '../issues/issues.service.js';
import { LicencesService } from '../licences/licences.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * The restaurant's home screen: how today is going at each of the person's
 * outlets. It adds nothing of its own; it gathers what the checklist,
 * licence and issue services already know, so the rules stay in one place.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly checklists: ChecklistsService,
    private readonly licences: LicencesService,
    private readonly issues: IssuesService,
  ) {}

  /**
   * One entry per outlet: all the brand's outlets for an Owner, the one
   * outlet for a Manager or Head Chef. ECCS staff get nothing here; their
   * view across clients is the web console.
   */
  async forUser(user: AuthUser): Promise<OutletDashboardDto[]> {
    const scope = accessScope(user.memberships, 'checklists');
    if (scope?.kind !== 'restaurant') return [];

    const outlets = await this.prisma.client.outlet.findMany({
      where: {
        isActive: true,
        OR: [{ organizationId: { in: scope.organizationIds } }, { id: { in: scope.outletIds } }],
      },
      select: { id: true, name: true, organizationId: true },
      orderBy: { name: 'asc' },
    });

    const [licences, issues] = await Promise.all([
      this.licences.listLicences(user, { attentionOnly: true }),
      this.issues.list(user, { openOnly: true }),
    ]);
    const today = indiaDate();

    return Promise.all(
      outlets.map(async (outlet) => {
        // The Head Chef's home shows today's checklists and nothing else.
        const overview = can(user.memberships, 'licences', 'read', {
          organizationId: outlet.organizationId,
          outletId: outlet.id,
        });
        const runs = await this.checklists.today(user, outlet.id);
        const outletIssues = issues.filter((issue) => issue.outletId === outlet.id);

        return {
          outletId: outlet.id,
          outletName: outlet.name,
          date: today,
          checklists: runs.map((run) => ({
            id: run.id,
            title: run.title,
            dueTime: run.dueTime,
            status: run.status,
            isOverdue: run.isOverdue,
            itemCount: run.items.length,
            doneCount: run.items.filter((item) => item.response).length,
            problemCount: run.items.filter((item) => item.response?.passed === false).length,
            reviewed: run.reviewedAt !== null,
          })),
          licences: overview
            ? licences
                .filter((licence) => licence.outletId === outlet.id)
                .map(({ id, type, name, expiresOn, daysLeft, state }) => ({ id, type, name, expiresOn, daysLeft, state }))
            : null,
          issues: overview
            ? {
                open: outletIssues.filter((issue) => issue.status === 'OPEN').length,
                inProgress: outletIssues.filter((issue) => issue.status === 'IN_PROGRESS').length,
              }
            : null,
        };
      }),
    );
  }
}
