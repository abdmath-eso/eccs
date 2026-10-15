import { Global, Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';
import { ActivityLogReaderService } from './activity-log-reader.service.js';
import { ActivityLogController } from './activity-log.controller.js';
import { ActivityLogInterceptor } from './activity-log.interceptor.js';
import { ActivityLogMiddleware } from './activity-log.middleware.js';
import { ActivityLogService } from './activity-log.service.js';
import { ActivityRoutesService } from './activity-routes.service.js';

/**
 * The activity log behind the console's Logs page (15 Oct 2026). Global, so any
 * service can record the server's own work through ActivityLogService.
 *
 * How every event is caught: the middleware opens a scratch pad for each request and
 * writes its row once the answer has gone; AuthGuard (the first guard) says which
 * handler it reached, whose @Activity key names the action, so a request refused at
 * the door is recorded too; the interceptor keeps a new record's id from the answer
 * and looks a record up before a delete. Services add safe facts with noteActivity().
 */
@Global()
@Module({
  imports: [DiscoveryModule],
  controllers: [ActivityLogController],
  providers: [
    ActivityLogService,
    ActivityLogReaderService,
    ActivityRoutesService,
    { provide: APP_INTERCEPTOR, useClass: ActivityLogInterceptor },
  ],
  exports: [ActivityLogService, ActivityRoutesService],
})
export class ActivityLogModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ActivityLogMiddleware).forRoutes('*');
  }
}
