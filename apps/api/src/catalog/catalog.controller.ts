import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  addServiceTaskSchema,
  createCatalogItemSchema,
  createServiceKindSchema,
  moveServiceTaskSchema,
  updateCatalogItemSchema,
  updateServiceKindSchema,
  updateServiceTaskSchema,
} from '@eccs/shared';
import type { z } from 'zod';
import { RequirePermission } from '../auth/auth.decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CatalogService } from './catalog.service.js';

// Managing the catalogue is for Super Admins and Operations Managers: they are
// the only roles with catalog:create and catalog:update. Supervisors and
// restaurants can read what is on offer (GET /services/catalog) but get
// nothing here, not even the list, which also shows what is no longer offered.
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @RequirePermission('catalog', 'update')
  overview() {
    return this.catalog.overview();
  }

  @Post('items')
  @RequirePermission('catalog', 'create')
  addItem(@Body(new ZodValidationPipe(createCatalogItemSchema)) body: z.output<typeof createCatalogItemSchema>) {
    return this.catalog.addItem(body);
  }

  @Patch('items/:id')
  @RequirePermission('catalog', 'update')
  updateItem(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCatalogItemSchema)) body: z.output<typeof updateCatalogItemSchema>,
  ) {
    return this.catalog.updateItem(id, body);
  }

  /** A brand-new kind of service, with its tax code. Its tasks and bookable services are added afterwards. */
  @Post('kinds')
  @RequirePermission('catalog', 'create')
  addKind(@Body(new ZodValidationPipe(createServiceKindSchema)) body: z.output<typeof createServiceKindSchema>) {
    return this.catalog.addKind(body);
  }

  @Patch('kinds/:code')
  @RequirePermission('catalog', 'update')
  updateKind(
    @Param('code') code: string,
    @Body(new ZodValidationPipe(updateServiceKindSchema)) body: z.output<typeof updateServiceKindSchema>,
  ) {
    return this.catalog.updateKind(code, body);
  }

  @Post('kinds/:code/tasks')
  @RequirePermission('catalog', 'create')
  addTask(
    @Param('code') code: string,
    @Body(new ZodValidationPipe(addServiceTaskSchema)) body: z.output<typeof addServiceTaskSchema>,
  ) {
    return this.catalog.addTask(code, body.label);
  }

  @Patch('tasks/:id')
  @RequirePermission('catalog', 'update')
  updateTask(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateServiceTaskSchema)) body: z.output<typeof updateServiceTaskSchema>,
  ) {
    return this.catalog.updateTask(id, body);
  }

  @Post('tasks/:id/move')
  @HttpCode(200)
  @RequirePermission('catalog', 'update')
  moveTask(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(moveServiceTaskSchema)) body: z.output<typeof moveServiceTaskSchema>,
  ) {
    return this.catalog.moveTask(id, body.direction);
  }
}
