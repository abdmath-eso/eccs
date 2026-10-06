import { Controller, Delete, Get, HttpCode, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ProfileService } from './profile.service.js';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** The parts of an uploaded file this controller uses. Files are held in memory, not on disk. */
interface UploadedPhoto {
  buffer: Buffer;
  size: number;
}

// Everyone who is logged in has a profile, so there is no permission to check:
// each call only ever reads or changes the caller's own.
@Controller('profile')
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.profile.get(user);
  }

  @Post('photo')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  setPhoto(@CurrentUser() user: AuthUser, @UploadedFile() file: UploadedPhoto | undefined) {
    return this.profile.setPhoto(user, file);
  }

  @Delete('photo')
  removePhoto(@CurrentUser() user: AuthUser) {
    return this.profile.removePhoto(user);
  }
}
