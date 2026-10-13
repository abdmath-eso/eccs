import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { VendorsService } from './vendors.service.js';

// The vendor directory is its own row of the permission table ("vendors"):
// the Owner and the Manager may read it; the Head Chef and every ECCS role are
// refused here, by the decorator. The service then checks the outlet the
// distances are measured from. There is nothing to write: reading only.
@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendors: VendorsService) {}

  /** The whole list as seen from one outlet, the nearest first. */
  @Get()
  @RequirePermission('vendors', 'read')
  list(@CurrentUser() user: AuthUser, @Query('outletId') outletId?: string) {
    if (!outletId) throw new BadRequestException('outletId is required');
    return this.vendors.list(user, outletId);
  }

  /** One vendor, with its distance from that outlet. */
  @Get(':id')
  @RequirePermission('vendors', 'read')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('outletId') outletId?: string) {
    if (!outletId) throw new BadRequestException('outletId is required');
    return this.vendors.get(user, id, outletId);
  }
}
