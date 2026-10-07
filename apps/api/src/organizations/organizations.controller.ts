import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  createOrganizationSchema,
  createOutletSchema,
  updateOrganizationSchema,
  updateOutletSchema,
  updateOwnerSchema,
} from '@eccs/shared';
import type { z } from 'zod';
import { RequirePermission } from '../auth/auth.decorators.js';
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
  create(@Body(new ZodValidationPipe(createOrganizationSchema)) body: z.output<typeof createOrganizationSchema>) {
    return this.organizations.create(body);
  }

  @Post(':id/outlets')
  @RequirePermission('clients', 'create')
  addOutlet(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createOutletSchema)) body: z.output<typeof createOutletSchema>,
  ) {
    return this.organizations.addOutlet(id, body);
  }

  // ───────── Changing a client afterwards. Each answers with the whole client as it now stands. ─────────

  @Patch(':id')
  @RequirePermission('clients', 'update')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateOrganizationSchema)) body: z.output<typeof updateOrganizationSchema>,
  ) {
    return this.organizations.update(id, body);
  }

  @Patch(':id/outlets/:outletId')
  @RequirePermission('clients', 'update')
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
  unlinkPhone(@Param('id') id: string, @Param('phoneId') phoneId: string) {
    return this.organizations.unlinkPhone(id, phoneId);
  }

  @Patch(':id/owners/:userId')
  @RequirePermission('clients', 'update')
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
  resetOwnerSetup(@Param('id') id: string, @Param('userId') userId: string) {
    return this.organizations.resetOwnerSetup(id, userId);
  }
}
