import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { tap, type Observable } from 'rxjs';
import { activityOf } from './activity-context.js';
import { ACTIVITY_META, type ActivityMeta } from './activity.decorator.js';
import { ActivityLogService } from './activity-log.service.js';

/**
 * Runs around every handler that got past the guards. Before a delete it starts
 * looking the record up (without waiting for it), so the log can still name what was
 * removed; afterwards it keeps the new record's id and the counts the route asked for
 * from the answer, and nothing else of it.
 */
@Injectable()
export class ActivityLogInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly activity: ActivityLogService,
  ) {}

  intercept(execution: ExecutionContext, next: CallHandler): Observable<unknown> {
    let meta: ActivityMeta | undefined;
    let context: ReturnType<typeof activityOf>;
    try {
      if (execution.getType() === 'http') {
        const request = execution.switchToHttp().getRequest<Request>();
        context = activityOf(request);
        meta = this.reflector.getAllAndOverride<ActivityMeta | undefined>(ACTIVITY_META, [execution.getHandler(), execution.getClass()]);
        if (context && meta && !meta.never && request.method === 'DELETE') this.activity.lookUpBefore(meta, context, request.body);
      }
    } catch {
      // The log never stands in the way of a request.
    }
    if (!context || !meta || meta.never || (meta.from !== 'answer' && !meta.answerFacts)) return next.handle();
    const into = context;
    const wanted = meta;
    return next.handle().pipe(
      tap((answer) => {
        try {
          if (!answer || typeof answer !== 'object') return;
          const value = answer as Record<string, unknown>;
          const facts: Record<string, number> = {};
          for (const field of wanted.answerFacts ?? []) if (typeof value[field] === 'number') facts[field] = value[field];
          // The new record's id, at `key` when the route says where (e.g. "user.id"), else at "id".
          const path = wanted.from === 'answer' && wanted.key ? wanted.key : 'id';
          const id = path.split('.').reduce<unknown>((at, part) => (at && typeof at === 'object' ? (at as Record<string, unknown>)[part] : undefined), value);
          into.answer = { ...(typeof id === 'string' && { id }), facts };
        } catch {
          // As above.
        }
      }),
    );
  }
}
