import { Module } from '@nestjs/common';
import { PdfModule } from '../pdf/pdf.module.js';
import { PlansService } from './plans.service.js';
import { ReportPdfService } from './report-pdf.service.js';
import { ServicesController } from './services.controller.js';
import { ServicesService } from './services.service.js';
import { WeekBoardService } from './week-board.service.js';

@Module({
  imports: [PdfModule],
  controllers: [ServicesController],
  providers: [ServicesService, ReportPdfService, PlansService, WeekBoardService],
  exports: [ServicesService, PlansService, WeekBoardService],
})
export class ServicesModule {}
