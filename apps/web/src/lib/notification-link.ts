import type { NotificationLink, NotificationType } from "@eccs/shared";

/**
 * The console page a notification is about, if the console has one for it.
 * The one mapping used by the notifications list, the message at the bottom of
 * the page and the desktop notification, so all three open the same place.
 */
export function hrefFor(link: NotificationLink | null, type?: NotificationType | null): string | null {
  switch (link?.kind) {
    case "visit":
      return `/visits?visit=${encodeURIComponent(link.visitId)}`;
    case "services":
      // A restaurant's request waits on Visits' Waiting tab until it is placed (20 Oct 2026).
      if (type === "BOOKING_REQUESTED") return "/visits?view=waiting";
      // The day's sheet is on Today, for a Supervisor reading it in the console (20 Oct 2026).
      // A rejected visit photo (PHOTO_REJECTED) carries a visit link and opens the visit above.
      if (type === "DAY_SHEET_SENT") return "/";
      return "/visits";
    case "issue":
      return `/issues?issue=${encodeURIComponent(link.issueId)}`;
    default:
      // Checklists, licences and documents, and staff logins belong to the restaurant's app
      // (the console's Licences page was removed on 20 Oct 2026).
      return null;
  }
}
