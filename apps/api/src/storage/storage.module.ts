import { Global, Module } from '@nestjs/common';
import { AttachmentsController } from './attachments.controller.js';
import { PhotoIntegrityService } from './photo-integrity.service.js';
import { StorageService } from './storage.service.js';

@Global()
@Module({
  controllers: [AttachmentsController],
  providers: [StorageService, PhotoIntegrityService],
  exports: [StorageService, PhotoIntegrityService],
})
export class StorageModule {}
