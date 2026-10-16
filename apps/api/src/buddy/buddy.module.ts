import { Module } from '@nestjs/common';
import { ChecklistsModule } from '../checklists/checklists.module.js';
import { DashboardModule } from '../dashboard/dashboard.module.js';
import { FoodLabelsModule } from '../food-labels/food-labels.module.js';
import { InspectionsModule } from '../inspections/inspections.module.js';
import { IssuesModule } from '../issues/issues.module.js';
import { LicencesModule } from '../licences/licences.module.js';
import { ScoresModule } from '../scores/scores.module.js';
import { ServicesModule } from '../services/services.module.js';
import { SopsModule } from '../sops/sops.module.js';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import { VendorsModule } from '../vendors/vendors.module.js';
import { BuddyActions } from './buddy-actions.js';
import { BuddyController, BuddyStatsController } from './buddy.controller.js';
import { BuddyService } from './buddy.service.js';
import { BuddyToolbox } from './buddy-tools.js';

/**
 * ECCS Buddy, the AI helper in the restaurant app for the Owner and the Manager (16 Oct 2026). It
 * reads and acts only through the other modules' own services, as the person asking. AI, billing,
 * certificates and the activity log are global modules.
 */
@Module({
  imports: [
    ChecklistsModule,
    ServicesModule,
    ScoresModule,
    LicencesModule,
    SubscriptionsModule,
    IssuesModule,
    InspectionsModule,
    SopsModule,
    FoodLabelsModule,
    VendorsModule,
    DashboardModule,
  ],
  controllers: [BuddyController, BuddyStatsController],
  providers: [BuddyService, BuddyToolbox, BuddyActions],
  exports: [BuddyService],
})
export class BuddyModule {}
