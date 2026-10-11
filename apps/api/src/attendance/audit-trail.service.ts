import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Writes to the AuditLog table: who did what to which record, and when. The
 * table has been in the database since the first migration; face attendance is
 * the first feature to write to it. Every enrolment, withdrawal, correction and
 * void is recorded here as well as on the record itself, so there is one place
 * to read the history of anything that can change someone's pay.
 *
 * Never put a face template, a photo or a similarity score of a named person
 * in `details`: the log is kept long after those are deleted.
 */
@Injectable()
export class AuditTrailService {
  private readonly logger = new Logger(AuditTrailService.name);

  constructor(private readonly prisma: PrismaService) {}

  async write(entry: {
    /** The login that did it; null when it was the server itself. */
    actorId: string | null;
    /** For example "attendance.punch.void". */
    action: string;
    entity: string;
    entityId: string;
    organizationId: string;
    details?: Prisma.InputJsonObject;
  }): Promise<void> {
    try {
      await this.prisma.client.auditLog.create({
        data: {
          actorId: entry.actorId,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId,
          organizationId: entry.organizationId,
          ...(entry.details && { metadata: entry.details }),
        },
      });
    } catch (error) {
      // The change itself has been made and carries its own who, when and why; a failed log line must not undo it.
      this.logger.error(`Could not write the audit log for ${entry.action} ${entry.entityId}: ${String(error)}`);
    }
  }
}
