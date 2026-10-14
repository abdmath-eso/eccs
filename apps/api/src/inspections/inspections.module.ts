import { Module } from '@nestjs/common';
import { PdfModule } from '../pdf/pdf.module.js';
import { InspectionPdfService } from './inspection-pdf.service.js';
import { InspectionSummaryService } from './inspection-summary.service.js';
import { InspectionsController } from './inspections.controller.js';
import { InspectionsService } from './inspections.service.js';

@Module({
  imports: [PdfModule],
  controllers: [InspectionsController],
  providers: [InspectionsService, InspectionPdfService, InspectionSummaryService],
  exports: [InspectionsService],
})
export class InspectionsModule {}
