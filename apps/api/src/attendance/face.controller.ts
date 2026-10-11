import { Body, Controller, Delete, Get, Param, Post, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { FACE_RULES, type FaceStatusDto } from '@eccs/shared';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { FaceService } from './face.service.js';

/** An uploaded photo, held in memory only: enrolment photos are turned into templates and never stored. */
interface Upload {
  buffer: Buffer;
}

// A person's face enrolment. The role check here keeps out everyone who cannot
// change staff at all (the Head Chef, ECCS); the service then lets only the
// Owner enrol or withdraw, and the Owner or Manager read where it stands.
@Controller('staff')
export class FaceController {
  constructor(private readonly face: FaceService) {}

  /**
   * Enrols the face from 3 to 5 photos (`photos`) taken now, with the employee's
   * own consent in `consent` (JSON: consentVersion, language, acceptedAt,
   * acceptedBy "EMPLOYEE"). Enrolling again replaces the earlier templates.
   */
  @Post(':id/face')
  @RequirePermission('staff', 'update')
  @UseInterceptors(FilesInterceptor('photos', FACE_RULES.enrolMaxPhotos, { limits: { fileSize: FACE_RULES.maxPhotoBytes * 2 } }))
  enrol(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFiles() photos: Upload[] | undefined,
    @Body() body: Record<string, unknown> | undefined,
  ): Promise<FaceStatusDto> {
    return this.face.enrol(user, id, (photos ?? []).map((photo) => photo.buffer), body?.consent);
  }

  /** Whether the person is enrolled, with how many templates and on which consent. Never the templates. */
  @Get(':id/face')
  @RequirePermission('staff', 'update')
  status(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<FaceStatusDto> {
    return this.face.status(user, id);
  }

  /** The employee withdraws consent: every template is deleted at once. */
  @Delete(':id/face')
  @RequirePermission('staff', 'update')
  withdraw(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<FaceStatusDto> {
    return this.face.withdraw(user, id);
  }
}
