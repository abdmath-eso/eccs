import { buddyScreenFor, mayUseBuddy, type BuddyOpenDto, type BuddyScreen, type MembershipScope } from '@eccs/shared';
import type { Href } from 'expo-router';

// The app's side of ECCS Buddy (16 Oct 2026): who sees it, which screen it was opened from, and
// where each of Buddy's Open buttons goes.

/** Buddy is the Owner's and the Manager's only. */
export const showsBuddy = (memberships: readonly MembershipScope[] | undefined) => mayUseBuddy(memberships ?? []);

/** The Buddy screen, opened from the screen at `pathname`, so its suggested prompts fit that screen. */
export function buddyHref(pathname: string): Href {
  const screen: BuddyScreen = buddyScreenFor(pathname);
  return { pathname: '/buddy', params: { screen } };
}

/** Where an Open button goes. `outletId` is the chat's outlet, for the screens that need it. */
export function openHref(open: BuddyOpenDto, outletId: string | null): Href {
  const p = open.params;
  switch (open.target) {
    case 'home':
      return '/';
    case 'checklists':
      return '/checklists';
    case 'checklist_setup':
      return outletId ? { pathname: '/checklists/setup', params: { outletId } } : '/checklists';
    case 'services':
      return '/services';
    case 'book_service':
      return p.itemId ? { pathname: '/services/book', params: { itemId: p.itemId } } : '/services/book';
    case 'visit':
      return p.visitId ? { pathname: '/services/[visitId]', params: { visitId: p.visitId } } : '/services';
    case 'calendar':
      return '/history';
    case 'sops':
      return '/sops';
    case 'sop':
      return p.sopId ? { pathname: '/sops/[sopId]', params: { sopId: p.sopId } } : '/sops';
    case 'sop_library':
      return '/sops/library';
    case 'labels':
      return '/labels';
    case 'documents':
      return '/documents';
    case 'certificates':
      return '/certificates';
    case 'invoices':
      return '/invoices';
    case 'invoice':
      return p.invoiceId ? { pathname: '/invoices/[invoiceId]', params: { invoiceId: p.invoiceId } } : '/invoices';
    case 'plan':
      return '/plan';
    case 'score':
      return '/score';
    case 'inspections':
      return '/inspections';
    case 'inspection':
      return p.inspectionId ? { pathname: '/inspections/[inspectionId]', params: { inspectionId: p.inspectionId } } : '/inspections';
    case 'support':
      return '/support';
    case 'issue':
      return p.issueId ? { pathname: '/support/[issueId]', params: { issueId: p.issueId } } : '/support';
    case 'staff':
      return '/team';
    case 'staff_add':
      // The name only: a PIN, a phone number or pay never pass through Buddy.
      return p.name ? { pathname: '/team/person', params: { name: p.name } } : '/team/person';
    case 'attendance':
      return '/team/attendance';
    case 'salary':
      return '/team/salary';
    case 'app_logins':
      return '/staff';
    case 'vendors':
      return '/vendors';
    case 'vendor':
      return p.vendorId && outletId ? { pathname: '/vendors/[vendorId]', params: { vendorId: p.vendorId, outletId } } : '/vendors';
    case 'customer_page':
      return '/customer-page';
    case 'notifications':
      return '/notifications';
    case 'profile':
      return '/profile';
  }
}
