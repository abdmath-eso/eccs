import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { CalendarModule } from './calendar/calendar.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { CertificatesModule } from './certificates/certificates.module.js';
import { ChecklistsModule } from './checklists/checklists.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { InspectionsModule } from './inspections/inspections.module.js';
import { IssuesModule } from './issues/issues.module.js';
import { LicencesModule } from './licences/licences.module.js';
import { MonitoringModule } from './monitoring/monitoring.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { OutletsModule } from './outlets/outlets.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ProfileModule } from './profile/profile.module.js';
import { ScoresModule } from './scores/scores.module.js';
import { ServicesModule } from './services/services.module.js';
import { RestaurantUsersModule } from './restaurant-users/restaurant-users.module.js';
import { SopsModule } from './sops/sops.module.js';
import { StorageModule } from './storage/storage.module.js';

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    AuthModule,
    OutletsModule,
    RestaurantUsersModule,
    OrganizationsModule,
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
  ],
  controllers: [AppController],
})
export class AppModule {}
