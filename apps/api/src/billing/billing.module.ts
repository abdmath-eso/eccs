import { Global, Module } from '@nestjs/common';
import { PdfModule } from '../pdf/pdf.module.js';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { InvoicePdfService } from './invoice-pdf.service.js';
import { PAYMENT_GATEWAY, SamplePaymentGateway } from './payment-gateway.js';

// Global, like certificates: the service loop calls BillingService when ECCS
// approves a report, without the services module having to import this one.
@Global()
@Module({
  imports: [PdfModule],
  controllers: [BillingController],
  providers: [
    BillingService,
    InvoicePdfService,
    // The one place that says how online payments are taken. Today: the sample
    // gateway (no provider, no money). See payment-gateway.ts for swapping it.
    { provide: PAYMENT_GATEWAY, useClass: SamplePaymentGateway },
  ],
  exports: [BillingService],
})
export class BillingModule {}
