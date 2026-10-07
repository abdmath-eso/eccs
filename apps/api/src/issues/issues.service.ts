import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  accessScope,
  can,
  isEccsRole,
  isIssueOpen,
  type IssueCategory,
  type IssueDto,
  type IssueStatus,
  type IssueSummaryDto,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { NotifyService } from '../notifications/notify.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

const issueInclude = {
  outlet: { select: { id: true, name: true, organizationId: true, organization: { select: { name: true } } } },
  raisedBy: { select: { name: true } },
  _count: { select: { comments: true, attachments: true } },
} as const satisfies Prisma.IssueInclude;

const detailInclude = {
  ...issueInclude,
  attachments: { orderBy: { createdAt: 'asc' } },
  comments: {
    orderBy: { createdAt: 'asc' },
    include: { author: { select: { name: true, memberships: { select: { role: true } } } } },
  },
} as const satisfies Prisma.IssueInclude;

type IssueRow = Prisma.IssueGetPayload<{ include: typeof issueInclude }>;
type IssueDetailRow = Prisma.IssueGetPayload<{ include: typeof detailInclude }>;

const reference = (value: number) => `ECCS-${String(value).padStart(4, '0')}`;

/**
 * ECCS support: issues a restaurant raises for ECCS to act on. Problems noted
 * on a daily checklist are a separate thing and never appear here.
 */
@Injectable()
export class IssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notify: NotifyService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** Issues the user may see, open ones first, newest first within each group. */
  async list(user: AuthUser, filter: { outletId?: string | undefined; openOnly: boolean }): Promise<IssueSummaryDto[]> {
    const scope = accessScope(user.memberships, 'issues');
    if (!scope) return [];

    let where: Prisma.IssueWhereInput;
    if (scope.kind === 'all') {
      where = {};
    } else if (scope.kind === 'assigned') {
      where = { outlet: { jobs: { some: { supervisorId: user.id } } } };
    } else {
      where = {
        OR: [{ outlet: { organizationId: { in: scope.organizationIds } } }, { outletId: { in: scope.outletIds } }],
      };
    }

    const issues = await this.db.issue.findMany({
      where: {
        ...where,
        ...(filter.outletId && { outletId: filter.outletId }),
        ...(filter.openOnly && { status: { in: ['OPEN', 'IN_PROGRESS'] } }),
      },
      include: issueInclude,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return issues
      .map(toSummary)
      .sort((a, b) => Number(isIssueOpen(b.status)) - Number(isIssueOpen(a.status)));
  }

  async get(user: AuthUser, issueId: string): Promise<IssueDto> {
    return this.toDto(await this.require(user, 'read', issueId));
  }

  /** Any restaurant user, including the Head Chef, raises an issue for their outlet. */
  async create(
    user: AuthUser,
    input: { outletId: string; category: IssueCategory; description: string; attachmentIds: string[] },
  ): Promise<IssueDto> {
    const outlet = await this.db.outlet.findUnique({
      where: { id: input.outletId },
      select: { id: true, organizationId: true },
    });
    const allowed =
      outlet &&
      can(user.memberships, 'issues', 'create', { organizationId: outlet.organizationId, outletId: outlet.id });
    if (!outlet || !allowed) throw new ForbiddenException('You cannot raise an issue for this outlet');

    const photoIds = [...new Set(input.attachmentIds)];
    if (photoIds.length > 0) {
      // Only photos this person uploaded for this outlet, not yet used elsewhere.
      const usable = await this.db.attachment.count({
        where: {
          id: { in: photoIds },
          outletId: outlet.id,
          uploadedById: user.id,
          kind: 'PROOF',
          issueId: null,
          checklistResponseId: null,
        },
      });
      if (usable !== photoIds.length) throw new BadRequestException('One of the photos could not be attached');
    }

    const issue = await this.db.$transaction(async (tx) => {
      const created = await tx.issue.create({
        data: {
          outletId: outlet.id,
          category: input.category,
          title: input.description.slice(0, 80),
          description: input.description,
          raisedById: user.id,
        },
      });
      if (photoIds.length > 0) {
        await tx.attachment.updateMany({ where: { id: { in: photoIds } }, data: { issueId: created.id } });
      }
      return created;
    });
    await this.notify.issueRaised(user, issue.id);
    return this.get(user, issue.id);
  }

  /** Adds a message to the conversation. Anyone who can see the issue may reply. */
  async addComment(user: AuthUser, issueId: string, body: string): Promise<IssueDto> {
    const issue = await this.require(user, 'read', issueId);
    await this.db.$transaction([
      this.db.issueComment.create({ data: { issueId: issue.id, authorId: user.id, body } }),
      // Touch the issue so lists sorted by activity reflect the new message.
      this.db.issue.update({ where: { id: issue.id }, data: { updatedAt: new Date() } }),
    ]);
    await this.notify.issueReplied(user, issue.id, body);
    return this.get(user, issue.id);
  }

  /**
   * Changes the status. ECCS staff move an issue through in progress and
   * resolved. The restaurant's Owner or Manager can only close it (for
   * example once they are satisfied, or if it was raised by mistake) or
   * reopen it.
   */
  async setStatus(user: AuthUser, issueId: string, status: IssueStatus): Promise<IssueDto> {
    const issue = await this.require(user, 'update', issueId);
    const fromEccs = user.memberships.some((m) => isEccsRole(m.role));
    if (!fromEccs && status !== 'CLOSED' && status !== 'OPEN') {
      throw new ForbiddenException('Only ECCS can set this status');
    }
    await this.db.issue.update({
      where: { id: issue.id },
      data: {
        status,
        resolvedAt: status === 'RESOLVED' || status === 'CLOSED' ? (issue.resolvedAt ?? new Date()) : null,
      },
    });
    await this.notify.issueStatusChanged(user, issue.id, issue.status);
    return this.get(user, issue.id);
  }

  /** Loads an issue if the user may act on it. "Not found" and "not yours" look the same. */
  private async require(user: AuthUser, action: 'read' | 'update', issueId: string): Promise<IssueDetailRow> {
    const issue = await this.db.issue.findUnique({ where: { id: issueId }, include: detailInclude });
    if (!issue) throw new NotFoundException('Issue not found');

    const target = { organizationId: issue.outlet.organizationId, outletId: issue.outletId };
    let allowed = can(user.memberships, 'issues', action, target);
    // A Supervisor is limited to outlets where they have visits assigned.
    if (allowed && accessScope(user.memberships, 'issues')?.kind === 'assigned') {
      allowed = (await this.db.job.count({ where: { outletId: issue.outletId, supervisorId: user.id } })) > 0;
    }
    if (!allowed) throw new NotFoundException('Issue not found');
    return issue;
  }

  private toDto(issue: IssueDetailRow): IssueDto {
    return {
      ...toSummary(issue),
      photoPaths: issue.attachments.map((photo) => this.storage.signedPath(photo.id)),
      resolvedAt: issue.resolvedAt?.toISOString() ?? null,
      comments: issue.comments.map((comment) => ({
        id: comment.id,
        authorName: comment.author.name,
        fromEccs: comment.author.memberships.some((m) => isEccsRole(m.role)),
        body: comment.body,
        createdAt: comment.createdAt.toISOString(),
      })),
    };
  }
}

function toSummary(issue: IssueRow): IssueSummaryDto {
  return {
    id: issue.id,
    reference: reference(issue.reference),
    outletId: issue.outletId,
    outletName: issue.outlet.name,
    organizationName: issue.outlet.organization.name,
    category: issue.category,
    status: issue.status,
    description: issue.description ?? issue.title,
    raisedByName: issue.raisedBy.name,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
    commentCount: issue._count.comments,
    photoCount: issue._count.attachments,
  };
}
