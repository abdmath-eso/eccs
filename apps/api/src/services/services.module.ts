import { Module } from '@nestjs/common';
import { ReportPdfService } from './report-pdf.service.js';
import { ServicesController } from './services.controller.js';
import { ServicesService } from './services.service.js';

@Module({
  controllers: [ServicesController],
  providers: [ServicesService, ReportPdfService],
  exports: [ServicesService],
})
export class ServicesModule {}
