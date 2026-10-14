import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { translate } from '@eccs/i18n';
import {
  documentsToAccept,
  isEccsRole,
  LEGAL_DOCUMENTS,
  pendingDocuments,
  RESTAURANT_ROLES,
  type AcceptLegalInput,
  type LegalAcceptedDto,
  type LegalDocument,
  type LegalDocumentDto,
  type LegalDocumentKey,
  type LegalStatusDto,
  type Role,
} from '@eccs/shared';
import { sha256 } from '../auth/auth.crypto.js';
import type { AuthUser } from '../auth/auth.types.js';
import { indiaDate } from '../checklists/checklists.service.js';
import { env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Where an agreement was made from, as the request shows it. */
export interface AcceptContext {
  ip: string | null;
  userAgent: string | null;
}

// Restaurant roles from the most senior down: an agreement is recorded under the
// most senior role that needs the document.
const SENIORITY: readonly Role[] = RESTAURANT_ROLES;

const cut = (text: string | null | undefined, length: number) => (text ? text.slice(0, length) : null);

/**
 * The legal documents (LEGAL_DOCUMENTS in packages/shared) and each person's
 * agreement to them. The agreements are the record of the contract: rows are
 * only ever added here, never changed or deleted.
 */
@Injectable()
export class LegalService {
  /** The documents in force. Tests may replace them, to see what a new version does. */
  private documents: readonly LegalDocument[] = LEGAL_DOCUMENTS;
  private gateOn = env.LEGAL_GATE === 'on';
  /**
   * People already known to have agreed to everything they must, so the gate does not
   * ask the database on each of their requests. Safe to keep for as long as the server
   * runs: a new version of a document is a change to the code, so the server restarts
   * with this empty, and an agreement is never taken back.
   */
  private readonly cleared = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  /** Whether the server refuses restaurant users who have documents to agree to (LEGAL_GATE). */
  get gateEnabled(): boolean {
    return this.gateOn;
  }

  /** Tests only: switch the refusing on or off for this run. */
  setGateForTest(on: boolean): void {
    if (env.NODE_ENV !== 'test') throw new Error('The terms gate can only be switched in tests');
    this.gateOn = on;
  }

  /** Tests only: put other documents (a new version of one) in force, or null to go back to the real ones. */
  setDocumentsForTest(documents: readonly LegalDocument[] | null): void {
    if (env.NODE_ENV !== 'test') throw new Error('The legal documents can only be replaced in tests');
    this.documents = documents ?? LEGAL_DOCUMENTS;
    this.cleared.clear();
  }

  // ───────────────────────── The documents, for anyone ─────────────────────────

  list(): LegalDocumentDto[] {
    return this.documents.map((document) => this.toDto(document));
  }

  find(key: string): LegalDocumentDto {
    const document = this.documents.find((entry) => entry.key === key);
    if (!document) throw new NotFoundException('There is no such document');
    return this.toDto(document);
  }

  // ───────────────────────── One person's agreements ─────────────────────────

  /**
   * The roles that decide what a person must agree to. ECCS's own staff are asked for
   * nothing (these are the customer's documents), even if they also hold a restaurant role.
   */
  private rolesOf(user: AuthUser): Role[] {
    const roles = user.memberships.map((m) => m.role);
    return roles.some(isEccsRole) ? [] : roles;
  }

  private agreements(userId: string) {
    return this.db.legalAcceptance.findMany({
      where: { userId },
      select: { documentKey: true, version: true, acceptedAt: true },
      orderBy: { acceptedAt: 'desc' },
    });
  }

  private pendingFrom(user: AuthUser, rows: { documentKey: string; version: string }[]) {
    return pendingDocuments(
      this.rolesOf(user),
      rows.map((row) => ({ key: row.documentKey, version: row.version })),
      this.documents,
    );
  }

  /** For the gate: true while the person has documents to agree to before anything else. */
  async mustAgreeFirst(user: AuthUser): Promise<boolean> {
    if (this.cleared.has(user.id)) return false;
    if (documentsToAccept(this.rolesOf(user), this.documents).length === 0) return false;
    const pending = this.pendingFrom(user, await this.agreements(user.id));
    if (pending.length === 0) this.cleared.add(user.id);
    return pending.length > 0;
  }

  /** What the person must agree to now, and their latest agreement to each document. */
  async status(user: AuthUser): Promise<LegalStatusDto> {
    const rows = await this.agreements(user.id);
    // Newest first, so the first row for a document is the latest agreement to it.
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) if (!latest.has(row.documentKey)) latest.set(row.documentKey, row);

    const accepted: LegalAcceptedDto[] = this.documents.flatMap((document) => {
      const row = latest.get(document.key);
      return row
        ? [{ key: document.key, version: row.version, acceptedAt: row.acceptedAt.toISOString(), acceptedOn: indiaDate(row.acceptedAt) }]
        : [];
    });
    const pending = this.pendingFrom(user, rows).map((document) => ({
      key: document.key,
      version: document.version,
      title: translate('EN', document.titleKey),
      acceptedVersion: latest.get(document.key)?.version ?? null,
    }));
    return { pending, accepted };
  }

  /**
   * Records the person's agreement. They must name every document pending for them, at
   * its current version, and nothing their role does not need; naming one they have
   * already agreed to at this version is harmless (pressing "Agree" twice records once).
   */
  async accept(user: AuthUser, input: AcceptLegalInput, from: AcceptContext): Promise<LegalStatusDto> {
    const roles = this.rolesOf(user);
    const required = documentsToAccept(roles, this.documents);
    if (required.length === 0) throw new BadRequestException('You have no documents to agree to');

    const named = new Set<LegalDocumentKey>();
    for (const sent of input.documents) {
      const document = required.find((entry) => entry.key === sent.key);
      if (!document || named.has(sent.key)) {
        throw new BadRequestException('Agree to exactly the documents shown to you');
      }
      if (document.version !== sent.version) {
        throw new BadRequestException('This document has been updated. Read it again, then agree.');
      }
      named.add(sent.key);
    }
    const pending = this.pendingFrom(user, await this.agreements(user.id));
    if (pending.some((document) => !named.has(document.key))) {
      throw new BadRequestException('Agree to exactly the documents shown to you');
    }

    if (pending.length > 0) {
      const session = await this.db.session.findUnique({
        where: { id: user.sessionId },
        select: { deviceName: true, linkedDevice: { select: { name: true } } },
      });
      const deviceName = cut(session?.linkedDevice?.name ?? session?.deviceName, 100);
      await this.db.legalAcceptance.createMany({
        data: pending.map((document) => {
          const role = SENIORITY.find((candidate) => roles.includes(candidate) && document.mustAgree.includes(candidate))!;
          const membership = user.memberships.find((m) => m.role === role);
          return {
            userId: user.id,
            documentKey: document.key,
            version: document.version,
            contentSha256: sha256(document.markdown),
            role,
            // The Owner agrees for the restaurant as a business, so the record names it.
            organizationId: role === 'OWNER' ? (membership?.organizationId ?? null) : null,
            outletId: membership?.outletId ?? null,
            language: input.language,
            ip: cut(from.ip, 64),
            userAgent: cut(from.userAgent, 500),
            deviceName,
            appVersion: cut(input.appVersion, 40),
          };
        }),
        // Two presses arriving together: the second finds the row already there.
        skipDuplicates: true,
      });
    }
    this.cleared.add(user.id);
    return this.status(user);
  }

  private toDto(document: LegalDocument): LegalDocumentDto {
    return { key: document.key, title: translate('EN', document.titleKey), version: document.version, markdown: document.markdown };
  }
}
