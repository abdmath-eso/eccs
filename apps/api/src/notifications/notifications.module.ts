import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { NotifyService } from './notify.service.js';
import { PushController } from './push.controller.js';
import { PushService } from './push.service.js';
import { RemindersService } from './reminders.service.js';

// Global, like the database module: almost every part of the API has something
// to tell people about, and this way each can ask for `NotifyService` without
// the modules having to import one another (which would go round in circles,
// since login itself sends notifications).
@Global()
@Module({
  controllers: [NotificationsController, PushController],
  providers: [PushService, NotificationsService, NotifyService, RemindersService],
  exports: [NotificationsService, NotifyService, RemindersService, PushService],
})
export class NotificationsModule {}
