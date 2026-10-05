import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { OutletsModule } from './outlets/outlets.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RestaurantUsersModule } from './restaurant-users/restaurant-users.module.js';

@Module({
  imports: [PrismaModule, AuthModule, OutletsModule, RestaurantUsersModule],
  controllers: [AppController],
})
export class AppModule {}
