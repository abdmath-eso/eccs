import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';

/** The console's Catalogue page: bookable services, kinds of service and their task lists. */
@Module({
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
