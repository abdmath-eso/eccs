import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  accessScope,
  can,
  hasWords,
  isEccsRole,
  isIssueOpen,
  storedTranslationFor,
  SUPPORT_TRANSLATION_JSON_SCHEMA,
  supportTranslationSchema,
  writtenInOwnScript,
  type AiLanguage,
  type AiTranslationDto,
  type IssueCategory,
  type IssueDto,
  type IssueStatus,
  type IssueSummaryDto,
  type StoredTranslations,
  type SupportTranslationAnswer,
} from '@eccs/shared';
import { supportTranslationInstructions } from '../ai/ai-prompts.js';
import { AiService } from '../ai/ai.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { NotifyService } from '../notifications/notify.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

/** At most this many messages are translated in one go: the newest, which are read first. */
const MAX_TRANSLATED_AT_ONCE = 30;

/** A message of the thread (the description, or a reply) as translation sees it. */
interface ThreadMessage {
  /** "issue" for the description, otherwise the reply's id. */
  id: string;
  text: string;
  authorId: string;
  stored: StoredTranslations | null;
}

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
    private readonly ai: AiService,
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
    // Each row carries the English (or app-language) translation of its text when one is
    // already kept, so the office can read its own list. A list never asks AI for one: it
    // is made when someone opens the issue, at most once per language.
    const target = readerLanguage(user);
    return issues
      .map((issue) => {
        const kept = needsTranslation(descriptionMessage(issue), user, target);
        return { ...toSummary(issue), descriptionTranslation: kept === 'missing' ? null : kept };
      })
      .sort((a, b) => Number(isIssueOpen(b.status)) - Number(isIssueOpen(a.status)));
  }

  async get(user: AuthUser, issueId: string): Promise<IssueDto> {
    return this.toDto(await this.require(user, 'read', issueId), user);
  }

  /**
   * Translates the thread's messages into the reader's language (feature 2a, 14 Oct
   * 2026), in one AI call, and keeps each translation on its message, so a message
   * is translated at most once per language. The app asks for this once, after
   * showing the thread, when `translationPending` is set; the originals show
   * meanwhile, and stay if translation is off or fails. The language each message
   * is in is detected in the same call. Sends to the AI: the messages' words only.
   */
  async translate(user: AuthUser, issueId: string): Promise<IssueDto> {
    const issue = await this.require(user, 'read', issueId);
    const target = readerLanguage(user);
    const wanted = threadMessages(issue)
      .filter((message) => needsTranslation(message, user, target) === 'missing')
      .slice(-MAX_TRANSLATED_AT_ONCE);
    if (wanted.length === 0 || !this.ai.isOn('translate-support')) return this.toDto(issue, user);

    const messages = wanted.map(({ id, text }) => ({ id, text }));
    const chars = messages.reduce((total, message) => total + message.text.length, 0);
    const result = await this.ai.run<SupportTranslationAnswer>({
      feature: 'translate-support',
      model: this.ai.modelFor('translate-support'),
      instructions: supportTranslationInstructions(target),
      text: JSON.stringify({ messages }),
      answer: { schema: SUPPORT_TRANSLATION_JSON_SCHEMA, check: supportTranslationSchema },
      maxOutputTokens: Math.min(8000, chars * 2 + 100 * messages.length + 200),
      who: { userId: user.id, organizationId: issue.outlet.organizationId, outletId: issue.outletId },
      facts: { target, messages },
    });
    if (!result.ok) return this.toDto(issue, user);

    for (const item of result.value.items) {
      const message = wanted.find((entry) => entry.id === item.id);
      if (!message) continue;
      const translations: StoredTranslations = {
        source: item.source,
        to: { ...message.stored?.to, ...(item.source !== target && item.text.trim() && { [target]: item.text.trim() }) },
      };
      const data = { translations: translations as object };
      if (message.id === 'issue') await this.db.issue.update({ where: { id: issue.id }, data });
      else await this.db.issueComment.update({ where: { id: message.id }, data });
    }
    return this.get(user, issue.id);
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
    // Reopened after ECCS resolved it or it was closed: kept, so Quality > Follow-ups brings the outlet in once per reopening.
    const reopened = status === 'OPEN' && (issue.status === 'RESOLVED' || issue.status === 'CLOSED');
    await this.db.issue.update({
      where: { id: issue.id },
      data: {
        status,
        resolvedAt: status === 'RESOLVED' || status === 'CLOSED' ? (issue.resolvedAt ?? new Date()) : null,
        ...(reopened && { reopenedAt: new Date(), reopenCount: { increment: 1 } }),
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

  /**
   * The issue as the reader sees it. Each message written in another language comes
   * with its stored translation into the reader's language, if there is one yet.
   */
  private toDto(issue: IssueDetailRow, user: AuthUser): IssueDto {
    const target = readerLanguage(user);
    const aiOn = this.ai.isOn('translate-support');
    let pending = false;
    const translationOf = (message: ThreadMessage): AiTranslationDto | null => {
      const found = needsTranslation(message, user, target);
      if (found !== 'missing') return found;
      if (aiOn) pending = true;
      return null;
    };
    const [description, ...replies] = threadMessages(issue).map(translationOf);
    return {
      ...toSummary(issue),
      photoPaths: issue.attachments.map((photo) => this.storage.signedPath(photo.id)),
      resolvedAt: issue.resolvedAt?.toISOString() ?? null,
      comments: issue.comments.map((comment, index) => ({
        id: comment.id,
        authorName: comment.author.name,
        fromEccs: comment.author.memberships.some((m) => isEccsRole(m.role)),
        body: comment.body,
        createdAt: comment.createdAt.toISOString(),
        translation: replies[index] ?? null,
      })),
      descriptionTranslation: description ?? null,
      translationPending: pending,
    };
  }
}

/** The language the reader's screen is in: the app's language in the app, English in the console. */
const readerLanguage = (user: AuthUser) => user.contentLanguage.toLowerCase() as AiLanguage;

/** The issue's own text (its description) as translation sees it. */
const descriptionMessage = (issue: IssueRow): ThreadMessage => ({
  id: 'issue',
  text: issue.description ?? issue.title,
  authorId: issue.raisedById,
  stored: issue.translations as StoredTranslations | null,
});

/** The description first, then the replies in order. */
function threadMessages(issue: IssueDetailRow): ThreadMessage[] {
  return [
    descriptionMessage(issue),
    ...issue.comments.map((comment) => ({
      id: comment.id,
      text: comment.body,
      authorId: comment.authorId,
      stored: comment.translations as StoredTranslations | null,
    })),
  ];
}

/**
 * What a reader sees for one message: its translation, null when none is needed,
 * or "missing" when it still has to be translated. Nothing is translated for the
 * person who wrote it, for a message with no words (a number, a time, an emoji),
 * or for one plainly written in the reader's own script (Telugu letters for a
 * Telugu reader); everything else is asked once, and the language detected.
 */
function needsTranslation(message: ThreadMessage, user: AuthUser, target: AiLanguage): AiTranslationDto | null | 'missing' {
  if (message.authorId === user.id || !hasWords(message.text) || writtenInOwnScript(message.text, target)) return null;
  return storedTranslationFor(message.stored, target);
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
