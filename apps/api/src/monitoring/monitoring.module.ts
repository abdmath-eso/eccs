import { Module } from '@nestjs/common';
import { MonitoringDigestService } from './monitoring-digest.service.js';
import { MonitoringController } from './monitoring.controller.js';
import { MonitoringService } from './monitoring.service.js';

@Module({
  controllers: [MonitoringController],
  providers: [MonitoringService, MonitoringDigestService],
})
export class MonitoringModule {}
