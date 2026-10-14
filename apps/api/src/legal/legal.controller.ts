import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import {
  acceptLegalSchema,
  type AcceptLegalInput,
  type LegalDocumentDto,
  type LegalStatusDto,
} from '@eccs/shared';
import { CurrentUser, Public } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest, AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AllowWithoutTerms } from './legal.decorators.js';
import { LegalService } from './legal.service.js';

/**
 * The Terms of Service, the Privacy Policy and the other legal documents. Reading
 * them needs no login, so they can be read before agreeing and from the public web
 * pages. Every route here stays open to someone who has not agreed yet: these are
 * how they agree.
 */
@Controller('legal')
@AllowWithoutTerms()
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  @Public()
  @Get('documents')
  documents(): LegalDocumentDto[] {
    return this.legal.list();
  }

  @Public()
  @Get('documents/:key')
  document(@Param('key') key: string): LegalDocumentDto {
    return this.legal.find(key);
  }

  /** What the logged-in person must agree to now, and what they have agreed to. */
  @Get('status')
  status(@CurrentUser() user: AuthUser): Promise<LegalStatusDto> {
    return this.legal.status(user);
  }

  @Post('accept')
  @HttpCode(200)
  accept(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(acceptLegalSchema)) body: AcceptLegalInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<LegalStatusDto> {
    // The address the request came from. The API does not trust X-Forwarded-For anywhere
    // (no "trust proxy"), so behind a proxy this is the proxy's address until that is set up.
    const userAgent = request.headers['user-agent'];
    return this.legal.accept(user, body, { ip: request.ip ?? null, userAgent: typeof userAgent === 'string' ? userAgent : null });
  }
}
