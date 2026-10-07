import { Module } from '@nestjs/common';
import { PdfPrinterService } from './pdf-printer.service.js';

/** Printing a report to PDF. Imported by each feature that makes one (visits, inspections). */
@Module({
  providers: [PdfPrinterService],
  exports: [PdfPrinterService],
})
export class PdfModule {}
