import { Module } from '@nestjs/common';
import { UsageController } from './usage.controller.js';
import { UsageService } from './usage.service.js';

/** The console's Usage page (23 Oct 2026): screens counted per person and day. The activity log is a global module. */
@Module({
  controllers: [UsageController],
  providers: [UsageService],
})
export class UsageModule {}
