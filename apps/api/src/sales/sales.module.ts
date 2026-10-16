import { Module } from '@nestjs/common';
import { PublicQuotesController } from './public-quotes.controller.js';
import { SalesFactsService } from './sales-facts.service.js';
import { SalesOverviewService } from './sales-overview.service.js';
import { SalesController } from './sales.controller.js';
import { SalesService } from './sales.service.js';
import { ShopBoardReaderService } from './shop-board-reader.service.js';

/** Sales and the CRM: the console's Sales page, the leads, quotes and their public page; the BDE's phone (B2). */
@Module({
  controllers: [SalesController, PublicQuotesController],
  providers: [SalesService, SalesFactsService, SalesOverviewService, ShopBoardReaderService],
  exports: [SalesService],
})
export class SalesModule {}
