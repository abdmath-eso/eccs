import { Module } from '@nestjs/common';
import { ActivityLogModule } from './activity-log/activity-log.module.js';
import { AiModule } from './ai/ai.module.js';
import { AppController } from './app.controller.js';
import { AttendanceModule } from './attendance/attendance.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BillingModule } from './billing/billing.module.js';
import { BuddyModule } from './buddy/buddy.module.js';
import { CalendarModule } from './calendar/calendar.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { CertificatesModule } from './certificates/certificates.module.js';
import { ChecklistsModule } from './checklists/checklists.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { InspectionsModule } from './inspections/inspections.module.js';
import { IssuesModule } from './issues/issues.module.js';
import { LegalModule } from './legal/legal.module.js';
import { LicencesModule } from './licences/licences.module.js';
import { MonitoringModule } from './monitoring/monitoring.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { OutletOnboardingModule } from './outlet-onboarding/outlet-onboarding.module.js';
import { OutletsModule } from './outlets/outlets.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ProfileModule } from './profile/profile.module.js';
import { ScoresModule } from './scores/scores.module.js';
import { StaffModule } from './staff/staff.module.js';
import { SubscriptionsModule } from './subscriptions/subscriptions.module.js';
import { FinanceModule } from './finance/finance.module.js';
import { SalesModule } from './sales/sales.module.js';
import { TeamModule } from './team/team.module.js';
import { TodayModule } from './today/today.module.js';
import { FoodLabelsModule } from './food-labels/food-labels.module.js';
import { PublicPageModule } from './public-page/public-page.module.js';
import { QualityModule } from './quality/quality.module.js';
import { UsageModule } from './usage/usage.module.js';
import { ServicesModule } from './services/services.module.js';
import { RestaurantUsersModule } from './restaurant-users/restaurant-users.module.js';
import { SopsModule } from './sops/sops.module.js';
import { StorageModule } from './storage/storage.module.js';
import { VendorsModule } from './vendors/vendors.module.js';

@Module({
  imports: [
    PrismaModule,
    // The activity log, global and early: every request passes its middleware first.
    ActivityLogModule,
    StorageModule,
    // The shared AI part, global, before the features that ask it.
    AiModule,
    AuthModule,
    OutletsModule,
    RestaurantUsersModule,
    OrganizationsModule,
    // Clients > New outlets: an outlet's first ten days (20 Oct 2026).
    OutletOnboardingModule,
    ChecklistsModule,
    IssuesModule,
    LicencesModule,
    DashboardModule,
    CalendarModule,
    SopsModule,
    ProfileModule,
    ServicesModule,
    NotificationsModule,
    InspectionsModule,
    ScoresModule,
    MonitoringModule,
    CatalogModule,
    CertificatesModule,
    SubscriptionsModule,
    BillingModule,
    StaffModule,
    AttendanceModule,
    FoodLabelsModule,
    PublicPageModule,
    VendorsModule,
    LegalModule,
    FinanceModule,
    SalesModule,
    TeamModule,
    BuddyModule,
    // Today, the console's home (20 Oct 2026): reads from the parts above.
    TodayModule,
    QualityModule,
    // The console's Usage page (23 Oct 2026).
    UsageModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
