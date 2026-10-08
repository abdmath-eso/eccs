import type { NotificationLink } from '@eccs/shared';
import { router } from 'expo-router';

import { rememberOutlet } from './use-outlet';

/**
 * Opens what a notification is about. An Owner with several branches lands on
 * the right one. Used by the notifications list and by a tap on a push
 * notification, so both always lead to the same place.
 */
export function openNotificationLink(link: NotificationLink) {
  if ('outletId' in link && link.outletId) void rememberOutlet(link.outletId);
  switch (link.kind) {
    case 'visit':
      return router.push({ pathname: '/services/[visitId]', params: { visitId: link.visitId } });
    case 'services':
      return router.push('/services');
    case 'issue':
      return router.push({ pathname: '/support/[issueId]', params: { issueId: link.issueId } });
    case 'checklist':
      return link.runId
        ? router.push({ pathname: '/checklists/[runId]', params: { runId: link.runId } })
        : router.push('/checklists');
    case 'documents':
      return router.push('/documents');
    case 'staff':
      return router.push('/staff');
  }
}
