import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module.js';
import { TeamSalaryService } from './team-salary.service.js';
import { TeamController } from './team.controller.js';
import { TeamService } from './team.service.js';

/** ECCS's own team: the console's Team page, and the salaries it gives the Finance page. */
@Module({
  imports: [SalesModule],
  controllers: [TeamController],
  providers: [TeamService, TeamSalaryService],
  exports: [TeamSalaryService],
})
export class TeamModule {}
