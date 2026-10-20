import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  createOrganizationSchema,
  createOutletSchema,
  updateOrganizationSchema,
  updateOutletSchema,
  updateOwnerSchema,
} from '@eccs/shared';
import type { z } from 'zod';
import { Activity } from '../activity-log/activity.decorator.js';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { OrganizationsService } from './organizations.service.js';

// The client list carries restaurant codes and owners' contact details, so
// every endpoint here needs clients:create or clients:update. Only ECCS
// Super Admins and Ops Managers hold those, across all organisations.
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @RequirePermission('clients', 'update')
  list() {
    return this.organizations.list();
  }

  @Post()
  @RequirePermission('clients', 'create')
  @Activity('clients.client.added', { entity: 'organization', from: 'answer' })
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createOrganizationSchema)) body: z.output<typeof createOrganizationSchema>) {
    // Who onboarded it is kept with the outlet's onboarding, as its step 1.
    return this.organizations.create(body, user.id);
  }

  @Post(':id/outlets')
  @RequirePermission('clients', 'create')
  @Activity('clients.outlet.added', { entity: 'outlet', from: 'answer' })
  addOutlet(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createOutletSchema)) body: z.output<typeof createOutletSchema>,
  ) {
    return this.organizations.addOutlet(id, body, user.id);
  }

  // ───────── Changing a client afterwards. Each answers with the whole client as it now stands. ─────────

  @Patch(':id')
  @RequirePermission('clients', 'update')
  @Activity('clients.client.changed', { entity: 'organization', facts: ['isActive'] })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateOrganizationSchema)) body: z.output<typeof updateOrganizationSchema>,
  ) {
    return this.organizations.update(id, body);
  }

  @Patch(':id/outlets/:outletId')
  @RequirePermission('clients', 'update')
  @Activity('clients.outlet.changed', { entity: 'outlet', key: 'outletId', facts: ['isActive'] })
  updateOutlet(
    @Param('id') id: string,
    @Param('outletId') outletId: string,
    @Body(new ZodValidationPipe(updateOutletSchema)) body: z.output<typeof updateOutletSchema>,
  ) {
    return this.organizations.updateOutlet(id, outletId, body);
  }

  @Post(':id/outlets/:outletId/new-code')
  @HttpCode(200)
  @RequirePermission('clients', 'update')
  // Never the new code: it is what links a phone to the kitchen.
  @Activity('clients.outlet.newCode', { entity: 'outlet', key: 'outletId' })
  newOutletCode(@Param('id') id: string, @Param('outletId') outletId: string) {
    return this.organizations.newOutletCode(id, outletId);
  }

  @Get(':id/phones')
  @RequirePermission('clients', 'update')
  phones(@Param('id') id: string) {
    return this.organizations.phones(id);
  }

  @Delete(':id/phones/:phoneId')
  @RequirePermission('clients', 'update')
  @Activity('clients.phone.unlinked', { entity: 'linkedDevice', key: 'phoneId' })
  unlinkPhone(@Param('id') id: string, @Param('phoneId') phoneId: string) {
    return this.organizations.unlinkPhone(id, phoneId);
  }

  @Patch(':id/owners/:userId')
  @RequirePermission('clients', 'update')
  @Activity('clients.owner.changed', { entity: 'user', key: 'userId' })
  updateOwner(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(updateOwnerSchema)) body: z.output<typeof updateOwnerSchema>,
  ) {
    return this.organizations.updateOwner(id, userId, body);
  }

  @Post(':id/owners/:userId/reset-setup')
  @HttpCode(200)
  @RequirePermission('clients', 'update')
  @Activity('clients.owner.setupReset', { entity: 'user', key: 'userId' })
  resetOwnerSetup(@Param('id') id: string, @Param('userId') userId: string) {
    return this.organizations.resetOwnerSetup(id, userId);
  }
}
