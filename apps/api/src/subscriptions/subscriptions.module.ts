import { Module } from '@nestjs/common';
import { ServicesModule } from '../services/services.module.js';
import { SubscriptionsController } from './subscriptions.controller.js';
import { SubscriptionsService } from './subscriptions.service.js';

/**
 * Plans as ECCS configures them and each outlet's subscription. It uses the
 * visits-from-plans generator of the services module to keep the diary right
 * after every change. Billing reads the subscriptions; nothing here invoices.
 */
@Module({
  imports: [ServicesModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
