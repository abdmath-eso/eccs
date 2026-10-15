import { Module } from '@nestjs/common';
import { ChecklistsController } from './checklists.controller.js';
import { ChecklistsService } from './checklists.service.js';
import { PhotoCheckService } from './photo-check.service.js';
import { PhotoStandardService } from './photo-standard.service.js';

@Module({
  controllers: [ChecklistsController],
  providers: [ChecklistsService, PhotoCheckService, PhotoStandardService],
  exports: [ChecklistsService],
})
export class ChecklistsModule {}
