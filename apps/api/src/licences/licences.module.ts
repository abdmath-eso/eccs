import { Module } from '@nestjs/common';
import { LicenceReaderService } from './licence-reader.service.js';
import { LicencesController } from './licences.controller.js';
import { LicencesService } from './licences.service.js';

@Module({
  controllers: [LicencesController],
  providers: [LicencesService, LicenceReaderService],
  exports: [LicencesService],
})
export class LicencesModule {}
