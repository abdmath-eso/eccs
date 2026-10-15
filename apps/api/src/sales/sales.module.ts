import { Module } from '@nestjs/common';
import { PublicQuotesController } from './public-quotes.controller.js';
import { SalesFactsService } from './sales-facts.service.js';
import { SalesOverviewService } from './sales-overview.service.js';
import { SalesController } from './sales.controller.js';
import { SalesService } from './sales.service.js';

/** Sales and the CRM: the console's Sales page, the leads, quotes and their public page. */
@Module({
  controllers: [SalesController, PublicQuotesController],
  providers: [SalesService, SalesFactsService, SalesOverviewService],
  exports: [SalesService],
})
export class SalesModule {}
