import { Global, Module } from '@nestjs/common';
import { PdfModule } from '../pdf/pdf.module.js';
import { CertificatePdfService } from './certificate-pdf.service.js';
import { CertificatesController } from './certificates.controller.js';
import { CertificatesService } from './certificates.service.js';

// Global, like notifications: the service loop calls CertificatesService when
// ECCS approves a report, without the services module having to import this one.
@Global()
@Module({
  imports: [PdfModule],
  controllers: [CertificatesController],
  providers: [CertificatesService, CertificatePdfService],
  exports: [CertificatesService],
})
export class CertificatesModule {}
