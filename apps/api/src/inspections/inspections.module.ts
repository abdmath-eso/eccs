import { Module } from '@nestjs/common';
import { InspectionsController } from './inspections.controller.js';
import { InspectionsService } from './inspections.service.js';

@Module({
  controllers: [InspectionsController],
  providers: [InspectionsService],
  exports: [InspectionsService],
})
export class InspectionsModule {}
