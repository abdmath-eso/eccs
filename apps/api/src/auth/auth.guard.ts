import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can } from '@eccs/shared';
import { IS_PUBLIC, REQUIRED_PERMISSION, type RequiredPermission } from './auth.decorators.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './auth.types.js';

/**
 * Applied to every endpoint. Requires a valid session unless the endpoint is
 * marked @Public(), then enforces @RequirePermission() if present.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    const user = scheme === 'Bearer' && token ? await this.auth.authenticate(token) : null;
    if (!user) {
      throw new UnauthorizedException('Please log in');
    }
    request.user = user;

    const required = this.reflector.getAllAndOverride<RequiredPermission | undefined>(REQUIRED_PERMISSION, targets);
    if (required && !can(user.memberships, required.resource, required.action)) {
      throw new ForbiddenException('Your role does not allow this');
    }
    return true;
  }
}
