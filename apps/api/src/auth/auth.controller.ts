import { Body, Controller, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';
import {
  pinSchema,
  requestOtpSchema,
  updateProfileSchema,
  verifyOtpSchema,
  type CurrentUserDto,
  type SessionDto,
} from '@eccs/shared';
import type { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CurrentUser, Public } from './auth.decorators.js';
import { AuthService } from './auth.service.js';
import type { AuthUser } from './auth.types.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('otp/request')
  @HttpCode(200)
  requestOtp(@Body(new ZodValidationPipe(requestOtpSchema)) body: z.output<typeof requestOtpSchema>) {
    return this.auth.requestOtp(body.phone);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  verifyOtp(@Body(new ZodValidationPipe(verifyOtpSchema)) body: z.output<typeof verifyOtpSchema>): Promise<SessionDto> {
    return this.auth.verifyOtp(body.phone, body.code, body.deviceName);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): CurrentUserDto {
    const { sessionId: _sessionId, ...dto } = user;
    return dto;
  }

  @Patch('me')
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: z.output<typeof updateProfileSchema>,
  ): Promise<CurrentUserDto> {
    return this.auth.updateProfile(user.id, body);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser): Promise<void> {
    await this.auth.logout(user.sessionId);
  }

  @Put('pin')
  @HttpCode(204)
  async setPin(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(pinSchema)) body: z.output<typeof pinSchema>,
  ): Promise<void> {
    await this.auth.setPin(user.id, body.pin);
  }

  @Post('pin/verify')
  @HttpCode(204)
  async verifyPin(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(pinSchema)) body: z.output<typeof pinSchema>,
  ): Promise<void> {
    await this.auth.verifyPin(user.id, body.pin);
  }
}
