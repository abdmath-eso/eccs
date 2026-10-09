import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { generateOutletCode, Prisma } from '@eccs/db';
import type { LinkedPhoneDto, OrganizationDto, OrganizationOutletDto } from '@eccs/shared';
import { PrismaService } from '../prisma/prisma.service.js';

const organizationInclude = {
  outlets: { orderBy: { name: 'asc' } },
  memberships: { where: { role: 'OWNER' }, include: { user: true } },
} as const satisfies Prisma.OrganizationInclude;

type OrganizationRow = Prisma.OrganizationGetPayload<{ include: typeof organizationInclude }>;

interface OutletInput {
  outletName: string;
  outletAddress: string;
  city?: string | undefined;
  pincode?: string | undefined;
  fssaiNumber?: string | undefined;
}

interface OrganizationInput extends OutletInput {
  name: string;
  legalName?: string | undefined;
  gstin?: string | undefined;
  ownerName: string;
  ownerPhone: string;
  ownerEmail?: string | undefined;
}

const isUniqueViolation = (error: unknown, field: string) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002' &&
  JSON.stringify(error.meta ?? {}).includes(field);

/** Clients (restaurant brands) and their outlets, managed by ECCS. */
@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  /** Every client. The controller restricts this to ECCS admins. */
  async list(): Promise<OrganizationDto[]> {
    const rows = await this.db.organization.findMany({
      include: organizationInclude,
      orderBy: { name: 'asc' },
    });
    return rows.map(toDto);
  }

  /**
   * Onboards a restaurant: creates the brand, its first outlet (with a new
   * restaurant code) and the Owner. The Owner then sets up on their phone
   * with their mobile number and a one-time code.
   */
  async create(input: OrganizationInput): Promise<OrganizationDto> {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const organization = await this.db.organization.create({
          data: {
            name: input.name,
            legalName: input.legalName ?? null,
            gstin: input.gstin ?? null,
            stateCode: input.gstin?.slice(0, 2) ?? null,
            contactPhone: input.ownerPhone,
            contactEmail: input.ownerEmail ?? null,
            outlets: { create: outletData(input) },
            memberships: {
              create: {
                role: 'OWNER',
                user: {
                  create: { name: input.ownerName, phone: input.ownerPhone, email: input.ownerEmail ?? null },
                },
              },
            },
          },
          include: organizationInclude,
        });
        return toDto(organization);
      } catch (error) {
        if (isUniqueViolation(error, 'phone')) {
          throw new ConflictException('That mobile number already belongs to another login');
        }
        if (isUniqueViolation(error, 'email')) {
          throw new ConflictException('That email address already belongs to another login');
        }
        // A restaurant code collided with an existing one: try again with a new code.
        if (!isUniqueViolation(error, 'code')) throw error;
      }
    }
    throw new ServiceUnavailableException('Could not generate a restaurant code. Try again.');
  }

  async addOutlet(organizationId: string, input: OutletInput): Promise<OrganizationOutletDto> {
    const organization = await this.db.organization.findUnique({ where: { id: organizationId } });
    if (!organization) throw new NotFoundException('Client not found');

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return toOutletDto(await this.db.outlet.create({ data: { organizationId, ...outletData(input) } }));
      } catch (error) {
        if (!isUniqueViolation(error, 'code')) throw error;
      }
    }
    throw new ServiceUnavailableException('Could not generate a restaurant code. Try again.');
  }

  // ───────────────────────── Changing a client afterwards ─────────────────────────
  // Nothing is ever deleted: visits, reports, licences and invoices hang off a
  // client and its outlets. Switching one off (`isActive` false) is how it is
  // retired, and switching it back on undoes it completely.

  /**
   * Changes a client's name, legal name or GSTIN, or switches the whole client
   * off or on. While a client is off nobody at any of its outlets can log in,
   * its restaurant codes link no phones and it takes no bookings or plan visits.
   */
  async update(
    organizationId: string,
    input: { name?: string | undefined; legalName?: string | undefined; gstin?: string | undefined; isActive?: boolean | undefined },
  ): Promise<OrganizationDto> {
    await this.requireOrganization(organizationId);
    await this.db.organization.update({
      where: { id: organizationId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.legalName !== undefined && { legalName: input.legalName || null }),
        // The first two digits of a GSTIN are the state, which decides the kind of GST on an invoice.
        ...(input.gstin !== undefined && { gstin: input.gstin || null, stateCode: input.gstin.slice(0, 2) || null }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
    });
    return this.get(organizationId);
  }

  /**
   * Changes an outlet's details, or switches it off or on. While an outlet is
   * off its Manager and Head Chefs cannot log in, its restaurant code links no
   * phones, and it gets no bookings, visits or plan visits.
   */
  async updateOutlet(
    organizationId: string,
    outletId: string,
    input: {
      name?: string | undefined;
      address?: string | undefined;
      city?: string | undefined;
      pincode?: string | undefined;
      fssaiNumber?: string | undefined;
      isActive?: boolean | undefined;
      /** Where the kitchen is; both `null` clears it. Used to judge where proof photos were taken. */
      latitude?: number | null | undefined;
      longitude?: number | null | undefined;
    },
  ): Promise<OrganizationDto> {
    await this.requireOutlet(organizationId, outletId);
    await this.db.outlet.update({
      where: { id: outletId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.address !== undefined && { address: input.address }),
        ...(input.city !== undefined && { city: input.city }),
        ...(input.pincode !== undefined && { pincode: input.pincode || null }),
        ...(input.fssaiNumber !== undefined && { fssaiNumber: input.fssaiNumber || null }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        ...(input.latitude !== undefined && input.longitude !== undefined && { latitude: input.latitude, longitude: input.longitude }),
      },
    });
    return this.get(organizationId);
  }

  /**
   * Gives an outlet a new restaurant code, for when the old one has got out.
   * The old code stops working at once for linking a new phone. Phones linked
   * already are not affected: a linked phone is remembered by its own token,
   * not by the code, so each one stays linked until it is unlinked here.
   */
  async newOutletCode(organizationId: string, outletId: string): Promise<OrganizationDto> {
    const outlet = await this.requireOutlet(organizationId, outletId);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await this.db.outlet.update({ where: { id: outletId }, data: { code: generateOutletCode(outlet.name) } });
        return this.get(organizationId);
      } catch (error) {
        if (!isUniqueViolation(error, 'code')) throw error;
      }
    }
    throw new ServiceUnavailableException('Could not generate a restaurant code. Try again.');
  }

  /** The phones linked to a client and still able to reach its PIN pad, most recently used first. */
  async phones(organizationId: string): Promise<LinkedPhoneDto[]> {
    await this.requireOrganization(organizationId);
    const devices = await this.db.linkedDevice.findMany({
      where: { organizationId, revokedAt: null },
      orderBy: { lastUsedAt: 'desc' },
    });
    return devices.map((device) => ({
      id: device.id,
      name: device.name,
      outletId: device.outletId,
      linkedAt: device.createdAt.toISOString(),
      lastUsedAt: device.lastUsedAt.toISOString(),
    }));
  }

  /**
   * Unlinks a phone: whoever is logged in on it is logged out, and it must be
   * linked again with the restaurant code (or the Owner's one-time code)
   * before a PIN works on it. Nobody's PIN changes.
   */
  async unlinkPhone(organizationId: string, phoneId: string): Promise<LinkedPhoneDto[]> {
    const device = await this.db.linkedDevice.findFirst({ where: { id: phoneId, organizationId, revokedAt: null } });
    if (!device) throw new NotFoundException('Phone not found');
    const now = new Date();
    await this.db.$transaction([
      this.db.linkedDevice.update({ where: { id: device.id }, data: { revokedAt: now } }),
      this.db.session.updateMany({ where: { linkedDeviceId: device.id, revokedAt: null }, data: { revokedAt: now } }),
    ]);
    return this.phones(organizationId);
  }

  /** Changes the Owner's name, mobile number (where their one-time code goes) or email. */
  async updateOwner(
    organizationId: string,
    userId: string,
    input: { name?: string | undefined; phone?: string | undefined; email?: string | undefined },
  ): Promise<OrganizationDto> {
    const owner = await this.requireOwner(organizationId, userId);
    const organization = await this.requireOrganization(organizationId);
    try {
      await this.db.$transaction([
        this.db.user.update({
          where: { id: userId },
          data: {
            ...(input.name !== undefined && { name: input.name }),
            ...(input.phone !== undefined && { phone: input.phone }),
            ...(input.email !== undefined && { email: input.email || null }),
          },
        }),
        // The client's own contact details were copied from this Owner at onboarding; keep them in step.
        this.db.organization.update({
          where: { id: organizationId },
          data: {
            ...(input.phone !== undefined && organization.contactPhone === owner.phone && { contactPhone: input.phone }),
            ...(input.email !== undefined && organization.contactEmail === owner.email && { contactEmail: input.email || null }),
          },
        }),
      ]);
    } catch (error) {
      if (isUniqueViolation(error, 'phone')) {
        throw new ConflictException('That mobile number already belongs to another login');
      }
      if (isUniqueViolation(error, 'email')) {
        throw new ConflictException('That email address already belongs to another login');
      }
      throw error;
    }
    return this.get(organizationId);
  }

  /**
   * For an Owner who has lost their PIN: removes it and logs them out, which
   * puts them back where a new Owner starts. They tap "I am the owner", enter
   * their mobile number and the one-time code, and the app shows a new PIN.
   * This is the same one-time-code set-up that onboarding uses; ECCS never
   * sees or chooses the PIN.
   */
  async resetOwnerSetup(organizationId: string, userId: string): Promise<OrganizationDto> {
    await this.requireOwner(organizationId, userId);
    await this.db.$transaction([
      this.db.user.update({ where: { id: userId }, data: { pinLookup: null } }),
      this.db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    return this.get(organizationId);
  }

  private async get(organizationId: string): Promise<OrganizationDto> {
    return toDto(await this.db.organization.findUniqueOrThrow({ where: { id: organizationId }, include: organizationInclude }));
  }

  private async requireOrganization(organizationId: string) {
    const organization = await this.db.organization.findUnique({ where: { id: organizationId } });
    if (!organization) throw new NotFoundException('Client not found');
    return organization;
  }

  private async requireOutlet(organizationId: string, outletId: string) {
    const outlet = await this.db.outlet.findFirst({ where: { id: outletId, organizationId } });
    if (!outlet) throw new NotFoundException('Outlet not found');
    return outlet;
  }

  private async requireOwner(organizationId: string, userId: string) {
    const membership = await this.db.membership.findFirst({
      where: { userId, organizationId, role: 'OWNER' },
      include: { user: true },
    });
    if (!membership) throw new NotFoundException('Owner not found');
    return membership.user;
  }
}

function outletData(input: OutletInput) {
  return {
    name: input.outletName,
    code: generateOutletCode(input.outletName),
    address: input.outletAddress,
    ...(input.city && { city: input.city }),
    pincode: input.pincode ?? null,
    fssaiNumber: input.fssaiNumber ?? null,
  };
}

function toOutletDto(outlet: OrganizationRow['outlets'][number]): OrganizationOutletDto {
  return {
    id: outlet.id,
    name: outlet.name,
    code: outlet.code,
    address: outlet.address,
    city: outlet.city,
    pincode: outlet.pincode,
    fssaiNumber: outlet.fssaiNumber,
    isActive: outlet.isActive,
    latitude: outlet.latitude,
    longitude: outlet.longitude,
  };
}

function toDto(row: OrganizationRow): OrganizationDto {
  return {
    id: row.id,
    name: row.name,
    legalName: row.legalName,
    gstin: row.gstin,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    owners: row.memberships.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      phone: m.user.phone,
      email: m.user.email,
      hasPin: m.user.pinLookup !== null,
    })),
    outlets: row.outlets.map(toOutletDto),
  };
}
