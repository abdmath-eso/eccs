import type { CurrentUserDto } from '@eccs/shared';
import type { Request } from 'express';

/** The logged-in user attached to each request by AuthGuard. */
export interface AuthUser extends CurrentUserDto {
  sessionId: string;
}

export type AuthenticatedRequest = Request & { user?: AuthUser };
