import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LEGAL_ERROR } from '@eccs/shared';
import { IS_PUBLIC } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { ALLOW_WITHOUT_TERMS } from './legal.decorators.js';
import { LegalService } from './legal.service.js';

/**
 * Applied to every endpoint, straight after AuthGuard (both are registered in
 * AuthModule, in that order, so the logged-in user is known here). A restaurant
 * user (Owner, Manager, Head Chef) who has documents to agree to is refused
 * everything with 403 and the code TERMS_NOT_ACCEPTED, which the app answers by
 * opening the acceptance screen. Agreeing is enforced here, on the server, so an
 * old app or a hand-made request cannot skip it.
 *
 * Not refused: endpoints anyone may call without logging in (logging in itself,
 * the documents, clocking in on the outlet's phone), endpoints marked
 * @AllowWithoutTerms() (logging out, the person's own login details, the /legal
 * routes, taking push notifications off the phone at Lock), and ECCS's own staff.
 * LEGAL_GATE=off switches the refusing off; the tests run with it off.
 */
@Injectable()
export class LegalGate implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly legal: LegalService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.legal.gateEnabled) return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_TERMS, targets)) return true;

    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user || !(await this.legal.mustAgreeFirst(user))) return true;
    throw new ForbiddenException({
      code: LEGAL_ERROR.notAccepted,
      message: 'Please agree to the Terms of Service and Privacy Policy to continue.',
    });
  }
}
