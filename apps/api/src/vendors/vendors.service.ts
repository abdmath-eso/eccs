import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  can,
  readVendorCategories,
  sortVendors,
  VENDOR_RULES,
  type LocalizedText,
  type VendorDirectoryDto,
  type VendorDto,
  type VendorPlace,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

// What the app is sent about a vendor. The loader's code and the dates stay on the server.
const vendorSelect = {
  id: true,
  name: true,
  categories: true,
  sells: true,
  area: true,
  city: true,
  address: true,
  latitude: true,
  longitude: true,
  phone: true,
  whatsapp: true,
  delivers: true,
  minOrderPaise: true,
  hours: true,
  fssaiNumber: true,
  isSample: true,
} as const satisfies Prisma.VendorSelect;

type VendorRow = Prisma.VendorGetPayload<{ select: typeof vendorSelect }>;

const outletSelect = { id: true, organizationId: true, latitude: true, longitude: true } as const satisfies Prisma.OutletSelect;
type OutletRow = Prisma.OutletGetPayload<{ select: typeof outletSelect }>;

/**
 * The vendor directory: wholesalers and distributors that sell in bulk to
 * restaurants, for the Owner and the Manager, seen from one of their outlets
 * with the nearest first.
 *
 * It is one list for every restaurant: a vendor belongs to no outlet. The
 * outlet only decides where distances are measured from (the place ECCS saved
 * for it), so the person must be allowed to read at that outlet: a Manager at
 * their own, the Owner at any outlet of their restaurant.
 *
 * Reading only. Vendors are loaded by `pnpm vendors:load` in packages/db;
 * nobody writes one through the API yet. The sorting and the 5 km rule are in
 * packages/shared/src/vendors.ts.
 */
@Injectable()
export class VendorsService {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  /** Every vendor on the list, the nearest to the outlet first; in name order when the outlet has no saved place. */
  async list(user: AuthUser, outletId: string): Promise<VendorDirectoryDto> {
    const outlet = await this.requireOutlet(user, outletId);
    const place = placeOf(outlet);
    const rows = await this.db.vendor.findMany({ where: { isActive: true }, select: vendorSelect });
    return {
      outletId: outlet.id,
      outletHasPlace: place !== null,
      nearbyMetres: VENDOR_RULES.nearbyMetres,
      // Sorted first and cut afterwards, so that if the list ever outgrows the limit it is the furthest that are left out.
      vendors: sortVendors(rows.map(toVendor), place).slice(0, VENDOR_RULES.maxListed),
    };
  }

  /** One vendor, with how far it is from the outlet. A vendor taken off the list is "not found". */
  async get(user: AuthUser, vendorId: string, outletId: string): Promise<VendorDto> {
    const outlet = await this.requireOutlet(user, outletId);
    const row = await this.db.vendor.findFirst({ where: { id: vendorId, isActive: true }, select: vendorSelect });
    if (!row) throw new NotFoundException('Vendor not found');
    return sortVendors([toVendor(row)], placeOf(outlet))[0]!;
  }

  /**
   * Checks the person may read the directory at this outlet. An outlet that does not exist and one
   * that is not theirs are refused in the same words. ECCS roles have no grant on vendors, so the
   * controller has already turned them away.
   */
  private async requireOutlet(user: AuthUser, outletId: string): Promise<OutletRow> {
    const outlet = await this.db.outlet.findUnique({ where: { id: outletId }, select: outletSelect });
    if (!outlet || !can(user.memberships, 'vendors', 'read', { organizationId: outlet.organizationId, outletId: outlet.id })) {
      throw new ForbiddenException('You cannot see the vendors for this outlet');
    }
    return outlet;
  }
}

/** Where the outlet is, if ECCS has saved its place; half a place is no place. */
function placeOf(outlet: OutletRow): VendorPlace | null {
  return outlet.latitude !== null && outlet.longitude !== null ? { latitude: outlet.latitude, longitude: outlet.longitude } : null;
}

/** A vendor as the app is sent it, before its distance is worked out. */
function toVendor(row: VendorRow): Omit<VendorDto, 'distanceMetres'> {
  return {
    ...row,
    // A category this version has no word for is left out rather than shown as a code.
    categories: readVendorCategories(row.categories),
    sells: row.sells as LocalizedText | null,
    hours: row.hours as LocalizedText | null,
  };
}
