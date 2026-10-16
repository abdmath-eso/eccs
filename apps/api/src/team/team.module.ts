import { Module } from '@nestjs/common';
import { PdfModule } from '../pdf/pdf.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { OnboardingPapersService } from './onboarding-papers.service.js';
import { OnboardingController } from './onboarding.controller.js';
import { OnboardingService } from './onboarding.service.js';
import { TeamSalaryService } from './team-salary.service.js';
import { TeamController } from './team.controller.js';
import { TeamService } from './team.service.js';

/** ECCS's own team: the console's Team page, onboarding a new member (16 Oct 2026), and the salaries it gives the Finance page. */
@Module({
  imports: [SalesModule, PdfModule],
  controllers: [TeamController, OnboardingController],
  providers: [TeamService, TeamSalaryService, OnboardingService, OnboardingPapersService],
  exports: [TeamSalaryService],
})
export class TeamModule {}
