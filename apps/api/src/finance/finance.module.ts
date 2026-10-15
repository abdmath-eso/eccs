import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller.js';
import { FinanceService } from './finance.service.js';

/** ECCS's own books: the console's Finance page (Super Admin only). */
@Module({
  controllers: [FinanceController],
  providers: [FinanceService],
})
export class FinanceModule {}
