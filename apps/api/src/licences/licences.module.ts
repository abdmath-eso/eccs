import { Module } from '@nestjs/common';
import { LicencesController } from './licences.controller.js';
import { LicencesService } from './licences.service.js';

@Module({
  controllers: [LicencesController],
  providers: [LicencesService],
})
export class LicencesModule {}
