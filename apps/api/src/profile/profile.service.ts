import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { can, mayRenameSelf, type ProfileDto } from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { sniffFile } from '../storage/attachments.controller.js';
import { StorageService } from '../storage/storage.service.js';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** "My profile": a person's own details, their restaurant and branches, and their photo. */
@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  async get(user: AuthUser): Promise<ProfileDto> {
    const person = await this.db.user.findUnique({ where: { id: user.id } });
    const membership = user.memberships[0];
    if (!person || !membership) throw new NotFoundException('Profile not found');

    // The Owner sees every outlet of the brand; a Manager or Head Chef their own.
    const organizationIds = user.memberships.filter((m) => m.role === 'OWNER' && m.organizationId).map((m) => m.organizationId!);
    const outletIds = user.memberships.filter((m) => m.outletId).map((m) => m.outletId!);
    const outlets =
      organizationIds.length + outletIds.length > 0
        ? await this.db.outlet.findMany({
            where: { isActive: true, OR: [{ organizationId: { in: organizationIds } }, { id: { in: outletIds } }] },
            select: { id: true, name: true, address: true, city: true, code: true, organizationId: true },
            orderBy: { name: 'asc' },
          })
        : [];

    return {
      id: person.id,
      name: person.name,
      phone: person.phone,
      email: person.email,
      language: person.language,
      role: membership.role,
      photoPath: person.photoId ? this.storage.signedPath(person.photoId) : null,
      organizationName: user.memberships.find((m) => m.organizationName)?.organizationName ?? null,
      outlets: outlets.map((outlet) => ({
        id: outlet.id,
        name: outlet.name,
        address: outlet.address,
        city: outlet.city,
        // The code lets a phone reach the PIN pad, so it only goes to the people who add staff there.
        code: can(user.memberships, 'restaurantUsers', 'create', { organizationId: outlet.organizationId, outletId: outlet.id })
          ? outlet.code
          : null,
      })),
      memberSince: person.createdAt.toISOString(),
      canEditName: mayRenameSelf(user.memberships.map((m) => m.role)),
    };
  }

  /** Stores a new profile photo and removes the one it replaces. */
  async setPhoto(user: AuthUser, file: { buffer: Buffer; size: number } | undefined): Promise<ProfileDto> {
    if (!file) throw new BadRequestException('A photo is required');
    const image = sniffFile(file.buffer, false);
    if (!image) throw new BadRequestException('Only JPEG, PNG or WebP photos are accepted');
    if (file.size > MAX_PHOTO_BYTES) throw new BadRequestException('That photo is too large');

    const id = randomUUID();
    const storageKey = `users/${user.id}/${id}.${image.extension}`;
    await this.storage.put(storageKey, file.buffer, image.mimeType);
    await this.db.attachment.create({
      data: { id, kind: 'PROFILE', storageKey, mimeType: image.mimeType, sizeBytes: file.size, uploadedById: user.id },
    });
    const previous = await this.db.user.findUnique({ where: { id: user.id }, select: { photoId: true } });
    await this.db.user.update({ where: { id: user.id }, data: { photoId: id } });
    await this.discard(previous?.photoId ?? null);
    return this.get(user);
  }

  async removePhoto(user: AuthUser): Promise<ProfileDto> {
    const previous = await this.db.user.findUnique({ where: { id: user.id }, select: { photoId: true } });
    await this.db.user.update({ where: { id: user.id }, data: { photoId: null } });
    await this.discard(previous?.photoId ?? null);
    return this.get(user);
  }

  /** Deletes a photo that is no longer anyone's, from the database and from storage. */
  private async discard(photoId: string | null) {
    if (!photoId) return;
    const attachment = await this.db.attachment.findFirst({ where: { id: photoId, kind: 'PROFILE' } });
    if (!attachment) return;
    await this.db.attachment.delete({ where: { id: attachment.id } });
    // A file left behind in storage wastes a little space; it is not worth failing the request over.
    await this.storage.remove(attachment.storageKey).catch(() => undefined);
  }
}
