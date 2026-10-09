import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  PUBLIC_PAGE_RULES,
  PUBLIC_PHOTO_CAPTIONS,
  PUBLIC_PHOTO_STATUSES,
  proposePublicPhotoSchema,
  rejectPublicPhotoSchema,
  setPublicPageSchema,
  takeDownPublicPageSchema,
  type PublicPageDto,
} from '@eccs/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CurrentUser, Public, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { readPhotoFacts } from '../storage/photo-integrity.service.js';
import { PublicPageService } from './public-page.service.js';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const newPhotoFieldsSchema = z.object({
  caption: z.enum(PUBLIC_PHOTO_CAPTIONS),
  capturedAt: z.iso.datetime().optional(),
});

/**
 * A plain brake on the two addresses anyone can call: at most this many requests a
 * minute from one network address. A link's token is 128 random bits, so guessing one
 * is not practical anyway; this only stops one caller from keeping the server busy.
 * The console's web server fetches pages on diners' behalf from a single address and
 * keeps each page for a minute itself, so the limit is set well above a busy evening.
 */
const REQUESTS_PER_MINUTE = 600;
const WINDOW_MS = 60_000;

/**
 * What a diner's phone asks for. No login, and only what the page shows. Every
 * reason for having nothing to show gives the very same "not found" answer.
 */
@Controller('public/pages')
export class PublicPagesController {
  private readonly callers = new Map<string, { since: number; count: number }>();

  constructor(private readonly pages: PublicPageService) {}

  private brake(request: Request) {
    const now = Date.now();
    const caller = request.ip ?? 'unknown';
    const seen = this.callers.get(caller);
    if (!seen || now - seen.since >= WINDOW_MS) {
      // Forget callers of earlier minutes so the list cannot grow without end.
      if (this.callers.size > 10_000) this.callers.clear();
      this.callers.set(caller, { since: now, count: 1 });
      return;
    }
    seen.count += 1;
    if (seen.count > REQUESTS_PER_MINUTE) throw new HttpException('Too many requests', 429);
  }

  @Public()
  @Get(':token')
  async page(@Param('token') token: string, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<PublicPageDto> {
    this.brake(request);
    // Not for search engines either way, and never kept by a browser when there is nothing to show.
    response.setHeader('X-Robots-Tag', 'noindex');
    response.setHeader('Cache-Control', 'no-store');
    const page = await this.pages.page(token);
    if (!page) throw new NotFoundException();
    response.setHeader('Cache-Control', `public, max-age=${PUBLIC_PAGE_RULES.cacheSeconds}`);
    return page;
  }

  /** One of the page's photos, by its place on the page. Nothing else in the photo store can be reached from here. */
  @Public()
  @Get(':token/photos/:place')
  async photo(
    @Param('token') token: string,
    @Param('place') place: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    this.brake(request);
    const photo = /^\d{1,2}$/.test(place) ? await this.pages.photo(token, Number(place)) : null;
    if (!photo) throw new NotFoundException();
    response.setHeader('Content-Type', photo.mimeType);
    response.setHeader('Content-Length', String(photo.body.length));
    // Short, because a photo's place changes when one is approved or removed.
    response.setHeader('Cache-Control', 'public, max-age=300');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Robots-Tag', 'noindex');
    response.end(photo.body);
  }
}

// The "Customer QR page" and "Customer QR photos" rows of the permission table:
// the Owner reads and changes the settings, the Manager reads, the Head Chef has no
// access; a Supervisor proposes photos; ECCS admins approve them and can take a page
// down. Which outlets and photos each of them reaches is narrowed in the service.
@Controller('public-page')
export class PublicPageController {
  constructor(private readonly pages: PublicPageService) {}

  // ───────────────────────── Photos ─────────────────────────

  /** By who asks: the approval queue (ECCS admins), their own proposals (a Supervisor), the page's photos (the restaurant). */
  @Get('photos')
  @RequirePermission('publicPage', 'read')
  photos(@CurrentUser() user: AuthUser, @Query('status') status?: string, @Query('outletId') outletId?: string) {
    const known = PUBLIC_PHOTO_STATUSES.find((entry) => entry === status);
    if (status && !known) throw new BadRequestException('Unknown status');
    return this.pages.listPhotos(user, { status: known, outletId: outletId || undefined });
  }

  /** How many photos wait for a decision, for the console's menu. */
  @Get('photos/waiting')
  @RequirePermission('publicPage', 'approve')
  waiting() {
    return this.pages.waiting();
  }

  /** A Supervisor proposes a photo from one of their own finished visits or inspections. */
  @Post('photos')
  @RequirePermission('publicPage', 'create')
  propose(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(proposePublicPhotoSchema)) body: z.output<typeof proposePublicPhotoSchema>,
  ) {
    return this.pages.propose(user, body);
  }

  @Post('photos/:id/approve')
  @HttpCode(200)
  @RequirePermission('publicPage', 'approve')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.pages.approve(user, id);
  }

  @Post('photos/:id/reject')
  @HttpCode(200)
  @RequirePermission('publicPage', 'approve')
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectPublicPhotoSchema)) body: z.output<typeof rejectPublicPhotoSchema>,
  ) {
    return this.pages.reject(user, id, body.reason);
  }

  /** The Owner (or ECCS) takes an approved photo off the page. */
  @Delete('photos/:id')
  @HttpCode(204)
  @RequirePermission('publicPage', 'update')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.pages.remove(user, id);
  }

  // ───────────────────────── One outlet's page ─────────────────────────

  @Get('outlets/:outletId')
  @RequirePermission('publicPage', 'read')
  settings(@CurrentUser() user: AuthUser, @Param('outletId') outletId: string) {
    return this.pages.settings(user, outletId);
  }

  /** The restaurant's own switch: the Owner only. */
  @Patch('outlets/:outletId')
  @RequirePermission('publicPage', 'update')
  setEnabled(
    @CurrentUser() user: AuthUser,
    @Param('outletId') outletId: string,
    @Body(new ZodValidationPipe(setPublicPageSchema)) body: z.output<typeof setPublicPageSchema>,
  ) {
    return this.pages.setEnabled(user, outletId, body.enabled);
  }

  /** Replaces the link, so codes printed earlier stop working: the Owner only. */
  @Post('outlets/:outletId/new-link')
  @HttpCode(200)
  @RequirePermission('publicPage', 'update')
  newLink(@CurrentUser() user: AuthUser, @Param('outletId') outletId: string) {
    return this.pages.newLink(user, outletId);
  }

  /** ECCS takes the page down, whatever the restaurant's switch says. */
  @Post('outlets/:outletId/take-down')
  @HttpCode(200)
  @RequirePermission('publicPage', 'approve')
  takeDown(
    @CurrentUser() user: AuthUser,
    @Param('outletId') outletId: string,
    @Body(new ZodValidationPipe(takeDownPublicPageSchema)) body: z.output<typeof takeDownPublicPageSchema>,
  ) {
    return this.pages.takeDown(user, outletId, body.reason);
  }

  @Post('outlets/:outletId/restore')
  @HttpCode(200)
  @RequirePermission('publicPage', 'approve')
  restore(@CurrentUser() user: AuthUser, @Param('outletId') outletId: string) {
    return this.pages.restore(user, outletId);
  }

  /** A Supervisor takes a photo specially for the page. */
  @Post('outlets/:outletId/photos')
  @RequirePermission('publicPage', 'create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  proposeNew(
    @CurrentUser() user: AuthUser,
    @Param('outletId') outletId: string,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
    @Body() body: unknown,
  ) {
    const fields = newPhotoFieldsSchema.safeParse(body);
    if (!fields.success) throw new BadRequestException('Say what the photo shows');
    if (!file) throw new BadRequestException('A photo is required');
    return this.pages.proposeNew(user, outletId, fields.data.caption, file, fields.data, readPhotoFacts(body));
  }
}
