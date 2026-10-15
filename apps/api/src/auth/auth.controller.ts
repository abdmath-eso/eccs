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
import { noteActivity } from '../activity-log/activity-context.js';
import { Activity } from '../activity-log/activity.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AllowWithoutTerms } from '../legal/legal.decorators.js';
import { CurrentUser, Public } from './auth.decorators.js';
import { AuthService } from './auth.service.js';
import type { AuthUser } from './auth.types.js';

// Logging in and out, and the person's own login details (read at app start, and
// their language), stay open to someone who has not agreed to the terms yet.
@Controller('auth')
@AllowWithoutTerms()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('otp/request')
  @HttpCode(200)
  @Activity('auth.otp.requested')
  requestOtp(@Body(new ZodValidationPipe(requestOtpSchema)) body: z.output<typeof requestOtpSchema>) {
    return this.auth.requestOtp(body.phone);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  @Activity('auth.otp.verified')
  verifyOtp(@Body(new ZodValidationPipe(verifyOtpSchema)) body: z.output<typeof verifyOtpSchema>): Promise<SessionDto> {
    return this.auth.verifyOtp(body.phone, body.code, body.deviceName, body.resetPin);
  }

  @Public()
  @Post('device/link')
  @HttpCode(200)
  @Activity('auth.device.linked', { side: 'restaurant' })
  linkDevice(
    @Body(new ZodValidationPipe(linkDeviceSchema)) body: z.output<typeof linkDeviceSchema>,
    @Ip() clientAddress: string,
  ): Promise<LinkedDeviceDto> {
    return this.auth.linkDevice(body.code, body.deviceName, clientAddress);
  }

  @Public()
  @Post('pin/login')
  @HttpCode(200)
  @Activity('auth.pin.login', { side: 'restaurant' })
  pinLogin(@Body(new ZodValidationPipe(pinLoginSchema)) body: z.output<typeof pinLoginSchema>): Promise<SessionDto> {
    return this.auth.pinLogin(body.deviceToken, body.pin);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): CurrentUserDto {
    const { sessionId: _sessionId, contentLanguage: _contentLanguage, linkedDeviceId: _linkedDeviceId, ...dto } = user;
    return dto;
  }

  @Patch('me')
  @Activity('profile.details.changed', { facts: ['language'] })
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
  @Activity('auth.session.loggedOut')
  async logout(@CurrentUser() user: AuthUser): Promise<void> {
    // Ending a login made on a linked phone is Lock: the phone goes back to its PIN pad.
    if (user.linkedDeviceId) noteActivity({ action: 'auth.session.locked' });
    await this.auth.logout(user.sessionId);
  }
}
