import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import type { Action, Resource } from '@eccs/shared';
import type { AuthenticatedRequest, AuthUser } from './auth.types.js';

export const IS_PUBLIC = 'auth:isPublic';
export const REQUIRED_PERMISSION = 'auth:requiredPermission';

export type RequiredPermission = { resource: Resource; action: Action };

/** Marks an endpoint as reachable without logging in. Everything else needs a session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Requires at least one of the user's roles to allow the action.
 * This is the coarse check; services still narrow rows to the user's
 * organisation, outlet or assignments.
 */
export const RequirePermission = (resource: Resource, action: Action) =>
  SetMetadata(REQUIRED_PERMISSION, { resource, action } satisfies RequiredPermission);

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.user) {
    throw new UnauthorizedException();
  }
  return request.user;
});
