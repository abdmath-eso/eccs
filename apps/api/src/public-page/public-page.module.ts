import { Module } from '@nestjs/common';
import { ChecklistsModule } from '../checklists/checklists.module.js';
import { PublicPageController, PublicPagesController } from './public-page.controller.js';
import { PublicPageService } from './public-page.service.js';

// The customer QR page: the public answer a diner's phone gets, the restaurant's
// switch, ECCS's take-down and the photo approvals. It reads checklists through the
// checklist service; storage and the database are global.
@Module({
  imports: [ChecklistsModule],
  controllers: [PublicPagesController, PublicPageController],
  providers: [PublicPageService],
  exports: [PublicPageService],
})
export class PublicPageModule {}
