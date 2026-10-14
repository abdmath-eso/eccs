import { Module } from '@nestjs/common';
import { LegalController } from './legal.controller.js';
import { LegalService } from './legal.service.js';

// The legal documents and each person's agreement to them. The gate that refuses
// restaurant users until they agree (LegalGate) is registered in AuthModule,
// straight after AuthGuard, so it always runs second.
@Module({
  controllers: [LegalController],
  providers: [LegalService],
  exports: [LegalService],
})
export class LegalModule {}
