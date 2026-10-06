import { Module } from '@nestjs/common';
import { SopsController } from './sops.controller.js';
import { SopsService } from './sops.service.js';

@Module({
  controllers: [SopsController],
  providers: [SopsService],
})
export class SopsModule {}
