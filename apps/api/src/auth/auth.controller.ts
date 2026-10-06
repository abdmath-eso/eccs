import { Body, Controller, Get, HttpCode, Ip, Patch, Post, ForbiddenException } from '@nestjs/common';
import {
  linkDeviceSchema,
  pinLoginSchema,
  requestOtpSchema,
  mayRenameSelf,
  updateProfileSchema,
  verifyOtpSchema,
  type CurrentUserDto,
  type LinkedDeviceDto,
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
    return this.auth.verifyOtp(body.phone, body.code, body.deviceName, body.resetPin);
  }

  @Public()
  @Post('device/link')
  @HttpCode(200)
  linkDevice(
    @Body(new ZodValidationPipe(linkDeviceSchema)) body: z.output<typeof linkDeviceSchema>,
    @Ip() clientAddress: string,
  ): Promise<LinkedDeviceDto> {
    return this.auth.linkDevice(body.code, body.deviceName, clientAddress);
  }

  @Public()
  @Post('pin/login')
  @HttpCode(200)
  pinLogin(@Body(new ZodValidationPipe(pinLoginSchema)) body: z.output<typeof pinLoginSchema>): Promise<SessionDto> {
    return this.auth.pinLogin(body.deviceToken, body.pin);
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
    // A Manager's or Head Chef's name appears on checklists and issues, so it is changed
    // by whoever manages staff logins, not by them. Everyone chooses their own language.
    if (body.name !== undefined && !mayRenameSelf(user.memberships.map((m) => m.role))) {
      throw new ForbiddenException('Ask your owner or manager to change your name');
    }
    return this.auth.updateProfile(user.id, body);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser): Promise<void> {
    await this.auth.logout(user.sessionId);
  }
}
