import type { Role } from '@eccs/shared';

/** The screens that can sit in the bottom bar. */
export type TabHref = '/' | '/checklists' | '/services' | '/history' | '/support' | '/sops' | '/inspections';

// The sections each role uses most, at most four; "More" in the bar opens the rest.
// The Head Chef has no calendar, so keeps Raise an issue and SOPs in the bar.
export const TAB_ROUTES: Record<Role, readonly TabHref[]> = {
  HEAD_CHEF: ['/', '/checklists', '/support', '/sops'],
  MANAGER: ['/', '/checklists', '/services', '/history'],
  OWNER: ['/', '/checklists', '/services', '/history'],
  // A Supervisor's work is visits and inspections.
  SUPERVISOR: ['/', '/services', '/inspections'],
  OPS_MANAGER: ['/', '/services'],
  SUPER_ADMIN: ['/', '/services'],
};

/** A path without its trailing slash, as the routes above are written. */
export const normalizePath = (pathname: string) => pathname.replace(/\/$/, '') || '/';

/**
 * True for the screens this role switches between with the bottom bar. They
 * show the bar and no Back button; any other screen, including a section
 * opened from "More", shows Back instead.
 */
export const isTabRoute = (pathname: string, role: Role | undefined) =>
  role !== undefined && (TAB_ROUTES[role] as readonly string[]).includes(normalizePath(pathname));
