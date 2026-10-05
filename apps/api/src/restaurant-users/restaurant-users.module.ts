import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RestaurantUsersController } from './restaurant-users.controller.js';
import { RestaurantUsersService } from './restaurant-users.service.js';

@Module({
  imports: [AuthModule],
  controllers: [RestaurantUsersController],
  providers: [RestaurantUsersService],
})
export class RestaurantUsersModule {}
