import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  registerPushDeviceSchema,
  sendTestPushSchema,
  unregisterPushDeviceSchema,
  type PushDeviceDto,
  type PushRecipientsDto,
  type PushTestResultDto,
  type RegisterPushDeviceInput,
  type SendTestPushInput,
  type UnregisterPushDeviceInput,
} from '@eccs/shared';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PushService } from './push.service.js';

/**
 * Push notifications. Registering and unregistering a phone is open to everyone
 * who is logged in and only ever concerns their own phone. The test push is for
 * ECCS admins (checked in the service).
 */
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  /** The app calls this after login: send my notifications to this phone. */
  @Post('devices')
  @HttpCode(200)
  register(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(registerPushDeviceSchema)) body: RegisterPushDeviceInput,
  ): Promise<PushDeviceDto> {
    return this.push.register(user.id, body);
  }

  /** The app calls this on Lock or logout, before the login ends: stop sending mine to this phone. */
  @Post('devices/unregister')
  @HttpCode(200)
  unregister(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(unregisterPushDeviceSchema)) body: UnregisterPushDeviceInput,
  ): Promise<PushDeviceDto> {
    return this.push.unregister(user.id, body.token);
  }

  /** For the console's test button: who has a phone registered. */
  @Get('recipients')
  recipients(@CurrentUser() user: AuthUser): Promise<PushRecipientsDto> {
    return this.push.recipients(user);
  }

  @Post('test')
  @HttpCode(200)
  test(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(sendTestPushSchema)) body: SendTestPushInput,
  ): Promise<PushTestResultDto> {
    return this.push.sendTest(user, body.userId);
  }
}
