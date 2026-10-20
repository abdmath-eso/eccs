import { Module } from '@nestjs/common';
import { OutletOnboardingModule } from '../outlet-onboarding/outlet-onboarding.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { ServicesModule } from '../services/services.module.js';
import { TeamModule } from '../team/team.module.js';
import { TodayController } from './today.controller.js';
import { TodayService } from './today.service.js';

/** Today, the console's home (20 Oct 2026): read from the other parts' own services, so the pages always agree. */
@Module({
  imports: [ServicesModule, OutletOnboardingModule, SalesModule, TeamModule],
  controllers: [TodayController],
  providers: [TodayService],
})
export class TodayModule {}
