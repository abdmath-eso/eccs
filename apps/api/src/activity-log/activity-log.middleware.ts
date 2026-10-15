import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import { ACTIVITY_APP_VERSION_HEADER, ACTIVITY_CLIENT_HEADER, activityClientFrom } from '@eccs/shared';
import type { NextFunction, Request, Response } from 'express';
import { runWithActivity, type ActivityRequestContext } from './activity-context.js';
import { ActivityLogService } from './activity-log.service.js';

const header = (request: Request, name: string): string | null => {
  const value = request.headers[name];
  return typeof value === 'string' ? value : null;
};

/**
 * Opens the activity log's scratch pad for every request, and once the answer has gone
 * (or the caller has gone away) hands it to the writer. Runs before the guards, so a
 * request refused at the door is recorded too. The request id goes back in the
 * X-Request-Id header, so a problem a person reports can be found in the log.
 */
@Injectable()
export class ActivityLogMiddleware implements NestMiddleware {
  constructor(private readonly activity: ActivityLogService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const context: ActivityRequestContext = {
      requestId: randomUUID(),
      at: new Date(),
      startedAt: Date.now(),
      method: request.method,
      ip: request.ip ?? null,
      client: activityClientFrom(header(request, ACTIVITY_CLIENT_HEADER), header(request, 'user-agent')),
      appVersion: header(request, ACTIVITY_APP_VERSION_HEADER),
      note: {},
    };
    response.setHeader('X-Request-Id', context.requestId);

    let done = false;
    const finish = (finished: boolean) => {
      if (done) return;
      done = true;
      try {
        this.activity.afterResponse(request, response, context, finished);
      } catch {
        // The log never breaks a request; the writer logs its own problems.
      }
    };
    response.once('finish', () => finish(true));
    response.once('close', () => finish(response.writableFinished));

    runWithActivity(request, context, next);
  }
}
