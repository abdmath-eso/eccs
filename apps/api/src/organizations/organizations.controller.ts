import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { createOrganizationSchema, createOutletSchema } from '@eccs/shared';
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
}
