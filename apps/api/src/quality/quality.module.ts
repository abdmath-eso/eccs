import { Module } from '@nestjs/common';
import { PdfModule } from '../pdf/pdf.module.js';
import { ServicesModule } from '../services/services.module.js';
import { FollowUpsService } from './follow-ups.service.js';
import { IncidentsService } from './incidents.service.js';
import { PhotoReviewsService } from './photo-reviews.service.js';
import { QualityController } from './quality.controller.js';
import { QualityService } from './quality.service.js';

/** Quality (console plan step 3, 20 Oct 2026): exported so Today can list its three kinds and Health its rejections. */
@Module({
  imports: [ServicesModule, PdfModule],
  controllers: [QualityController],
  providers: [QualityService, FollowUpsService, PhotoReviewsService, IncidentsService],
  exports: [QualityService, FollowUpsService, PhotoReviewsService, IncidentsService],
})
export class QualityModule {}
