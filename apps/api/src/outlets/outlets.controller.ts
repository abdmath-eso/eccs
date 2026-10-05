import { Controller, Get } from '@nestjs/common';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { OutletsService } from './outlets.service.js';

@Controller('outlets')
export class OutletsController {
  constructor(private readonly outlets: OutletsService) {}

  @Get()
  @RequirePermission('clients', 'read')
  list(@CurrentUser() user: AuthUser) {
    return this.outlets.listFor(user);
  }
}
