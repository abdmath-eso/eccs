import { Module } from '@nestjs/common';
import { OutletOnboardingController } from './outlet-onboarding.controller.js';
import { OutletOnboardingService } from './outlet-onboarding.service.js';

@Module({
  controllers: [OutletOnboardingController],
  providers: [OutletOnboardingService],
  exports: [OutletOnboardingService],
})
export class OutletOnboardingModule {}
