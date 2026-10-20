import { Injectable } from '@nestjs/common';
import {
  can,
  indiaDay,
  QUALITY_RULES,
  qualityHeadline,
  qualityStrip,
  type QualityCountsDto,
  type QualityMonthFacts,
  type QualitySummaryDto,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FollowUpsService } from './follow-ups.service.js';
import { IncidentsService } from './incidents.service.js';
import { PhotoReviewsService } from './photo-reviews.service.js';

// The Quality page as a whole (20 Oct 2026): its headline, the counts behind its tabs and the
// menu's badge, and the month strip at its foot (visits rated and the average, reports approved
// first time, follow-ups closed, incidents), the field-service "callback rate" idea in ECCS's own
// measures. The three queues are their own services.

@Injectable()
export class QualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly followUps: FollowUpsService,
    private readonly photos: PhotoReviewsService,
    private readonly incidents: IncidentsService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** How many things wait in each tab. Customer-page photos count only for someone who may approve them. */
  async counts(user: AuthUser, now: Date): Promise<QualityCountsDto & { kitchens: number }> {
    const approves = can(user.memberships, 'publicPage', 'approve');
    const [followUps, photos, customerPhotos, incidents] = await Promise.all([
      this.followUps.openCounts(now),
      this.photos.waitingCount(now),
      approves ? this.db.publicPhoto.count({ where: { status: 'PROPOSED' } }) : Promise.resolve(0),
      this.db.incident.count({ where: { status: 'OPEN' } }),
    ]);
    return {
      followUps: followUps.notBooked,
      photos,
      customerPhotos,
      incidents,
      total: followUps.notBooked + photos + customerPhotos + incidents,
      kitchens: followUps.kitchens,
    };
  }

  async summary(user: AuthUser, now: Date): Promise<QualitySummaryDto> {
    const [{ kitchens, ...counts }, strip] = await Promise.all([this.counts(user, now), this.monthFacts(now)]);
    return {
      headline: qualityHeadline({ followUpKitchens: kitchens, photos: counts.photos + counts.customerPhotos, incidents: counts.incidents }),
      counts,
      strip: qualityStrip(strip),
      approvesCustomerPhotos: can(user.memberships, 'publicPage', 'approve'),
    };
  }

  /** This India month's figures, from its first day to now. */
  async monthFacts(now: Date): Promise<QualityMonthFacts> {
    const month = indiaDay(now).slice(0, 7);
    const start = new Date(`${month}-01T00:00:00.000+05:30`);
    const [signedOff, rated, low, visitsApproved, visitsFirstTime, inspectionsApproved, inspectionsFirstTime, followUps, incidents] = await Promise.all([
      this.db.signOff.count({ where: { signedAt: { gte: start } } }),
      this.db.signOff.aggregate({ where: { signedAt: { gte: start }, rating: { not: null } }, _count: { rating: true }, _sum: { rating: true } }),
      this.db.signOff.count({ where: { signedAt: { gte: start }, rating: { lte: QUALITY_RULES.lowRatingStars } } }),
      this.db.job.count({ where: { reviewedAt: { gte: start } } }),
      this.db.job.count({ where: { reviewedAt: { gte: start }, returnedCount: 0 } }),
      this.db.inspection.count({ where: { status: 'APPROVED', approvedAt: { gte: start } } }),
      this.db.inspection.count({ where: { status: 'APPROVED', approvedAt: { gte: start }, returnedCount: 0 } }),
      this.followUps.monthFacts(start),
      this.incidents.monthFacts(month),
    ]);
    return {
      month,
      signedOff,
      rated: rated._count.rating,
      starsTotal: rated._sum.rating ?? 0,
      lowRated: low,
      reportsApproved: visitsApproved + inspectionsApproved,
      reportsFirstTime: visitsFirstTime + inspectionsFirstTime,
      ...followUps,
      ...incidents,
    };
  }
}
