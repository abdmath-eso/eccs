import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { can, type AttachmentDto } from '@eccs/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, Public } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PhotoIntegrityService, readPhotoFacts } from './photo-integrity.service.js';
import { StorageService } from './storage.service.js';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** The parts of an uploaded file this controller uses. Files are held in memory, not on disk. */
interface UploadedPhoto {
  buffer: Buffer;
  size: number;
}

const uploadFieldsSchema = z.object({
  outletId: z.string().min(1),
  /** PROOF: a photo for a checklist or issue. DOCUMENT: a photo or PDF for licences and the vault. */
  kind: z.enum(['PROOF', 'DOCUMENT']).default('PROOF'),
  /** Chosen by the phone so that retrying an upload does not create a second copy. */
  id: z.uuid().optional(),
  capturedAt: z.iso.datetime().optional(),
});

/** Works out the real file type from its first bytes, ignoring what the client claims. */
export function sniffFile(bytes: Buffer, allowPdf: boolean): { mimeType: string; extension: string } | null {
  if (allowPdf && bytes.length > 5 && bytes.toString('ascii', 0, 5) === '%PDF-') {
    return { mimeType: 'application/pdf', extension: 'pdf' };
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: 'image/png', extension: 'png' };
  }
  if (bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return { mimeType: 'image/webp', extension: 'webp' };
  }
  return null;
}

@Controller('attachments')
export class AttachmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly integrity: PhotoIntegrityService,
  ) {}

  /**
   * Uploads a file for an outlet: a proof photo (linked to a checklist answer
   * or issue afterwards) or a document (filed as a licence or in the vault).
   */
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 } }))
  async upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedPhoto | undefined,
    @Body() body: unknown,
  ): Promise<AttachmentDto> {
    const fields = uploadFieldsSchema.safeParse(body);
    if (!fields.success) throw new BadRequestException('Invalid upload');
    const isDocument = fields.data.kind === 'DOCUMENT';
    if (!file) throw new BadRequestException(isDocument ? 'A file is required' : 'A photo is required');
    const image = sniffFile(file.buffer, isDocument);
    if (!image) {
      throw new BadRequestException(
        isDocument ? 'Only PDF, JPEG, PNG or WebP files are accepted' : 'Only JPEG, PNG or WebP photos are accepted',
      );
    }
    if (!isDocument && file.size > MAX_PHOTO_BYTES) throw new BadRequestException('That photo is too large');

    const outlet = await this.prisma.client.outlet.findUnique({
      where: { id: fields.data.outletId },
      select: { id: true, organizationId: true },
    });
    const target = outlet ? { organizationId: outlet.organizationId, outletId: outlet.id } : null;
    const allowed =
      target &&
      (isDocument
        ? can(user.memberships, 'documents', 'create', target) || can(user.memberships, 'licences', 'create', target)
        : can(user.memberships, 'checklists', 'create', target) || can(user.memberships, 'issues', 'create', target));
    if (!outlet || !allowed) throw new ForbiddenException('You cannot add files for this outlet');

    const id = fields.data.id ?? randomUUID();
    const existing = await this.prisma.client.attachment.findUnique({ where: { id } });
    if (existing) {
      // A retry of an upload that already succeeded.
      if (existing.uploadedById !== user.id || existing.outletId !== outlet.id) {
        throw new ForbiddenException('You cannot add photos for this outlet');
      }
      return { id, path: this.storage.signedPath(id) };
    }

    const now = new Date();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const storageKey = `outlets/${outlet.id}/${now.getUTCFullYear()}/${month}/${id}.${image.extension}`;
    await this.storage.put(storageKey, file.buffer, image.mimeType);
    await this.prisma.client.attachment.create({
      data: {
        id,
        outletId: outlet.id,
        kind: fields.data.kind,
        storageKey,
        mimeType: image.mimeType,
        sizeBytes: file.size,
        capturedAt: fields.data.capturedAt ? new Date(fields.data.capturedAt) : now,
        uploadedById: user.id,
        // What is known about a proof photo, kept now and judged when it is attached to a checklist answer.
        // A document needs none of it.
        ...(!isDocument &&
          this.integrity.captureColumns({ buffer: file.buffer, mimeType: image.mimeType }, fields.data.capturedAt, now, readPhotoFacts(body))),
      },
    });
    return { id, path: this.storage.signedPath(id) };
  }

  /**
   * Serves a photo. No login is needed because image tags cannot send one;
   * instead the link carries a signature and stops working after an hour.
   */
  @Public()
  @Get(':id/content')
  async content(
    @Param('id') id: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() response: Response,
  ): Promise<void> {
    if (!this.storage.verifySignedPath(id, Number(exp), sig ?? '')) {
      throw new ForbiddenException('This link has expired');
    }
    const attachment = await this.prisma.client.attachment.findUnique({ where: { id } });
    if (!attachment) throw new NotFoundException();

    const body = await this.storage.get(attachment.storageKey);
    response.setHeader('Content-Type', attachment.mimeType);
    // Show PDFs in the browser or viewer rather than forcing a download.
    if (attachment.mimeType === 'application/pdf') response.setHeader('Content-Disposition', 'inline; filename="document.pdf"');
    response.setHeader('Cache-Control', 'private, max-age=3600');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    body.pipe(response);
  }
}
