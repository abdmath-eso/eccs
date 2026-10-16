import { Module } from '@nestjs/common';
import { TeamModule } from '../team/team.module.js';
import { FinanceController } from './finance.controller.js';
import { FinanceService } from './finance.service.js';

/** ECCS's own books: the console's Finance page (Super Admin only). Its Salaries line comes from the Team page. */
@Module({
  imports: [TeamModule],
  controllers: [FinanceController],
  providers: [FinanceService],
})
export class FinanceModule {}
