import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { LegalGate } from '../legal/legal.gate.js';
import { LegalModule } from '../legal/legal.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';

@Module({
  imports: [LegalModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    // Global guards run in the order they are listed: first who is logged in, then
    // whether they have agreed to the terms (which needs to know who it is).
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: LegalGate },
  ],
  exports: [AuthService],
})
export class AuthModule {}
