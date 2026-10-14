import { Module } from '@nestjs/common';
import { ChecklistsModule } from '../checklists/checklists.module.js';
import { InspectionsModule } from '../inspections/inspections.module.js';
import { LicencesModule } from '../licences/licences.module.js';
import { ScoreExplainService } from './score-explain.service.js';
import { ScoresController } from './scores.controller.js';
import { ScoresService } from './scores.service.js';

@Module({
  imports: [ChecklistsModule, LicencesModule, InspectionsModule],
  controllers: [ScoresController],
  providers: [ScoresService, ScoreExplainService],
  exports: [ScoresService],
})
export class ScoresModule {}
