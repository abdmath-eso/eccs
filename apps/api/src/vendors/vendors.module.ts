import { Module } from '@nestjs/common';
import { VendorsController } from './vendors.controller.js';
import { VendorsService } from './vendors.service.js';

// The vendor directory: nearby wholesalers and distributors, for the Owner and the Manager.
@Module({
  controllers: [VendorsController],
  providers: [VendorsService],
  // ECCS Buddy reads through it, as the person asking (apps/api/src/buddy).
  exports: [VendorsService],
})
export class VendorsModule {}
