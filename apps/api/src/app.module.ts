import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { ChecklistsModule } from './checklists/checklists.module.js';
import { IssuesModule } from './issues/issues.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { OutletsModule } from './outlets/outlets.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RestaurantUsersModule } from './restaurant-users/restaurant-users.module.js';
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
  ],
  controllers: [AppController],
})
export class AppModule {}
