import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { isActivityAction } from '@eccs/shared';
import { ACTIVITY_META, type ActivityMeta } from './activity.decorator.js';
import { routeMethod, routePattern } from './activity-log.service.js';

export interface DiscoveredRoute {
  method: string;
  route: string;
  controller: string;
  handler: string;
  /** The @Activity key, if the route has one. */
  action: string | null;
  /** Why the route is never recorded, if it is not. */
  never: string | null;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Lists every route the API has, through Nest's own route discovery, with its activity
 * key. The test that no route which changes something goes unrecorded uses it, and the
 * server warns at start-up about any route that lacks a key or names an unknown one.
 */
@Injectable()
export class ActivityRoutesService implements OnApplicationBootstrap {
  private readonly logger = new Logger('ActivityLog');

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  routes(): DiscoveredRoute[] {
    const found: DiscoveredRoute[] = [];
    for (const wrapper of this.discovery.getControllers()) {
      const controller = wrapper.metatype as (abstract new (...args: never[]) => unknown) | null;
      if (!controller?.prototype) continue;
      const prototype = controller.prototype as Record<string, unknown>;
      for (const name of this.scanner.getAllMethodNames(prototype)) {
        const handler = prototype[name];
        if (typeof handler !== 'function') continue;
        const method = routeMethod(handler);
        if (!method) continue;
        const meta = this.reflector.getAllAndOverride<ActivityMeta | undefined>(ACTIVITY_META, [handler, controller]);
        found.push({
          method,
          route: routePattern(controller, handler) ?? '',
          controller: controller.name,
          handler: name,
          action: meta?.action ?? null,
          never: meta?.never ?? null,
        });
      }
    }
    return found.sort((a, b) => a.route.localeCompare(b.route) || a.method.localeCompare(b.method));
  }

  /** Routes that change something but carry no known action key. Must always be empty. */
  unlabelled(): DiscoveredRoute[] {
    return this.routes().filter((route) => MUTATING.has(route.method) && (!route.action || !isActivityAction(route.action)));
  }

  onApplicationBootstrap() {
    for (const route of this.unlabelled()) {
      this.logger.warn(`${route.method} ${route.route} (${route.controller}.${route.handler}) has no activity log action and is not recorded`);
    }
  }
}
