import { Module } from '@nestjs/common';
import { ChecklistsController } from './checklists.controller.js';
import { ChecklistsService } from './checklists.service.js';
import { PhotoCheckService } from './photo-check.service.js';

@Module({
  controllers: [ChecklistsController],
  providers: [ChecklistsService, PhotoCheckService],
  exports: [ChecklistsService],
})
export class ChecklistsModule {}
