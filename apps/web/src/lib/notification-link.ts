import type { NotificationLink } from "@eccs/shared";

/**
 * The console page a notification is about, if the console has one for it.
 * The one mapping used by the notifications list, the message at the bottom of
 * the page and the desktop notification, so all three open the same place.
 */
export function hrefFor(link: NotificationLink | null): string | null {
  switch (link?.kind) {
    case "visit":
      return `/visits?visit=${encodeURIComponent(link.visitId)}`;
    case "services":
      return "/visits";
    case "issue":
      return `/issues?issue=${encodeURIComponent(link.issueId)}`;
    case "documents":
      return "/licences";
    default:
      // Checklists and staff logins belong to the restaurant's app.
      return null;
  }
}
