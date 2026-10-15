import { Body, Controller, Get, HttpCode, HttpException, NotFoundException, Param, Post, Req, Res } from '@nestjs/common';
import type { PublicQuoteDto } from '@eccs/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Activity } from '../activity-log/activity.decorator.js';
import { Public } from '../auth/auth.decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SalesService } from './sales.service.js';

/** What a quote link's secret part looks like; anything else is "not found" without asking the database. */
const TOKEN = /^[A-Za-z0-9_-]{10,64}$/;

/** At most this many requests a minute from one address: the console's web server asks on owners' behalf. */
const REQUESTS_PER_MINUTE = 300;
const WINDOW_MS = 60_000;

const openedSchema = z.object({ agent: z.string().max(400).optional().nullable() });

/**
 * The quote's public page (/q/<token> on the console's web server), with no login, as
 * the customer QR page is: what the owner reads, and the record that they opened it.
 * Only a sent quote has a page; a draft, an unknown link and a mistyped one all answer
 * the same "not found". Never indexed by search engines.
 */
@Controller('public/quotes')
export class PublicQuotesController {
  private readonly callers = new Map<string, { since: number; count: number }>();

  constructor(private readonly sales: SalesService) {}

  private brake(request: Request) {
    const now = Date.now();
    const caller = request.ip ?? 'unknown';
    const seen = this.callers.get(caller);
    if (!seen || now - seen.since >= WINDOW_MS) {
      if (this.callers.size > 10_000) this.callers.clear();
      this.callers.set(caller, { since: now, count: 1 });
      return;
    }
    seen.count += 1;
    if (seen.count > REQUESTS_PER_MINUTE) throw new HttpException('Too many requests', 429);
  }

  @Public()
  @Get(':token')
  async quote(@Param('token') token: string, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<PublicQuoteDto> {
    this.brake(request);
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    response.setHeader('Cache-Control', 'no-store');
    const quote = TOKEN.test(token) ? await this.sales.publicQuote(token) : null;
    if (!quote) throw new NotFoundException();
    return quote;
  }

  /**
   * The owner opened the quote. The web server calls this for each person's visit (not for
   * a link-preview robot, nor for ECCS's own preview) and sends the visitor's browser
   * name, so a robot is never counted. Recorded on the lead once in any 30 minutes.
   */
  @Public()
  @Post(':token/opened')
  @HttpCode(200)
  @Activity('sales.quote.opened', { side: 'public' })
  async opened(@Param('token') token: string, @Req() request: Request, @Body(new ZodValidationPipe(openedSchema)) body: { agent?: string | null }): Promise<{ recorded: boolean }> {
    this.brake(request);
    if (!TOKEN.test(token)) throw new NotFoundException();
    return this.sales.recordOpen(token, body.agent ?? request.headers['user-agent'] ?? null);
  }
}
