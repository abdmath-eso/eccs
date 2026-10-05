import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { generateOutletCode, Prisma } from '@eccs/db';
import type { OrganizationDto, OrganizationOutletDto } from '@eccs/shared';
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
    isActive: outlet.isActive,
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
