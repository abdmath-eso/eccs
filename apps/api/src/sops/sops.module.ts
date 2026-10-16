import { Module } from '@nestjs/common';
import { SopsController } from './sops.controller.js';
import { SopsService } from './sops.service.js';

@Module({
  controllers: [SopsController],
  providers: [SopsService],
  // ECCS Buddy reads through it, as the person asking (apps/api/src/buddy).
  exports: [SopsService],
})
export class SopsModule {}
