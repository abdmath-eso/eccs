import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CertificatesService } from './certificates.service.js';

// Certificates are covered by the "reports" row of the permission table
// (service reports and certificates): the Owner, the Manager and ECCS staff
// may read; the Head Chef has no access. Which rows each of them gets is
// narrowed in the service.
@Controller('certificates')
export class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  /** The newest first. With `outletId`, one outlet's; without, every one the person may see. */
  @Get()
  @RequirePermission('reports', 'read')
  list(@CurrentUser() user: AuthUser, @Query('outletId') outletId?: string) {
    return this.certificates.list(user, { outletId: outletId || undefined });
  }

  @Get(':id')
  @RequirePermission('reports', 'read')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.certificates.get(user, id);
  }

  /** A signed link to the certificate as a PDF, for anyone who may read it. */
  @Post(':id/pdf')
  @HttpCode(200)
  @RequirePermission('reports', 'read')
  pdf(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.certificates.pdf(user, id);
  }

  /** ECCS admins make the PDF again; the new one takes the old one's place. */
  @Post(':id/pdf/remake')
  @HttpCode(200)
  @RequirePermission('reports', 'approve')
  remakePdf(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.certificates.remakePdf(user, id);
  }
}
