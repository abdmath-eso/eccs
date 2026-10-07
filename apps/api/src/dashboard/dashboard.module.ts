import { Module } from '@nestjs/common';
import { ChecklistsModule } from '../checklists/checklists.module.js';
import { IssuesModule } from '../issues/issues.module.js';
import { LicencesModule } from '../licences/licences.module.js';
import { ServicesModule } from '../services/services.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

@Module({
  imports: [ChecklistsModule, IssuesModule, LicencesModule, ServicesModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
