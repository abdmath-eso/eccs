import { Global, Module } from '@nestjs/common';
import { AttachmentsController } from './attachments.controller.js';
import { StorageService } from './storage.service.js';

@Global()
@Module({
  controllers: [AttachmentsController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
