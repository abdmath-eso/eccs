import {
  notificationWordingParams,
  VISIT_SLOTS,
  visitSlotWindow,
  type IssueCategory,
  type LocalizedText,
  type NotificationParamValue,
  type NotificationType,
} from '@eccs/shared';

// The English wording of every notification. It is stored with each one, for the
// console (which is in English only) and as a fallback for an app that does not
// know a newer kind. The mobile app words notifications itself, in the reader's
// language, from the same sentences in `packages/i18n/src/en.ts` ("notif.<TYPE>.title"
// and ".body"): keep the two in step.
const ENGLISH: Record<NotificationType, { title: string; body: string }> = {
  REPORT_READY: { title: 'Service report ready', body: 'Report {reportNumber} for {service} is ready. Open it as a PDF.' },
  BOOKING_REQUESTED: { title: 'New booking request', body: '{outlet} asked for {service} on {date}, {time}.' },
  BOOKING_CONFIRMED: { title: 'Booking confirmed', body: 'ECCS confirmed {service} for {date}, {time}.' },
  BOOKING_DECLINED: {
    title: 'Booking not accepted',
    body: 'ECCS could not take your request for {service} on {date}. Call us to rearrange.',
  },
  VISIT_MOVED: { title: 'Visit moved', body: '{service} has moved to {date}, {time}.' },
  VISIT_CANCELLED: { title: 'Visit cancelled', body: '{service} on {date} has been cancelled.' },
  VISIT_ASSIGNED: { title: 'New visit for you', body: '{service} at {outlet}, {date}, {time}.' },
  VISIT_UNASSIGNED: {
    title: 'Visit no longer yours',
    body: '{service} at {outlet} on {date} has been given to someone else or cancelled.',
  },
  VISIT_TOMORROW: { title: 'Visit tomorrow', body: 'ECCS {service} is tomorrow, {time}.' },
  VISIT_STARTED: { title: 'ECCS has arrived', body: 'The ECCS team has arrived for {service}.' },
  VISIT_FINISHED: { title: 'Visit finished', body: '{service} is finished. Check the photos and sign off.' },
  SIGN_OFF_WAITING: { title: 'Waiting for your sign-off', body: '{service} from {date} is waiting for your sign-off.' },
  VISIT_SIGNED_OFF: {
    title: 'Visit signed off',
    body: '{outlet} signed off {service}: {stars} out of 5 stars. The report is ready to approve.',
  },
  VISIT_LOW_RATING: { title: 'Low rating', body: '{outlet} gave {service} {stars} out of 5 stars. {comment}' },
  REPORT_RETURNED: { title: 'Report sent back', body: 'ECCS asked for a correction on {service} at {outlet}: {note}' },
  VISIT_NOT_DONE: { title: 'Visit not done', body: '{service} at {outlet} on {date} was not done.' },
  PLAN_VISITS_UNASSIGNED: { title: 'Plan visits need a Supervisor', body: 'New plan visits without a Supervisor: {count}.' },
  PLAN_STARTED: { title: 'Service plan started', body: '{outlet} is now on the {plan} plan. First visit: {date}.' },
  PLAN_ENDED: { title: 'Service plan ended', body: 'The {plan} plan at {outlet} has ended.' },
  CHECKLIST_OVERDUE: { title: 'Checklist overdue', body: '{checklist} is overdue.' },
  CHECKLIST_PROBLEM: { title: 'Problem on a checklist', body: '{name} reported a problem on {checklist}: {item}' },
  CHECKLIST_MISSED: { title: 'Checklist missed', body: '{checklist} was missed on {date}.' },
  ISSUE_RAISED: { title: 'New issue', body: '{outlet} raised {reference}: {category}. "{excerpt}"' },
  ISSUE_REPLY_ECCS: { title: 'ECCS replied', body: 'ECCS replied on {reference}: "{excerpt}"' },
  ISSUE_REPLY_RESTAURANT: { title: 'Reply on an issue', body: '{outlet} replied on {reference}: "{excerpt}"' },
  ISSUE_IN_PROGRESS: { title: 'Issue in progress', body: 'ECCS is working on {reference}.' },
  ISSUE_RESOLVED: { title: 'Issue resolved', body: 'ECCS marked {reference} as resolved.' },
  ISSUE_CLOSED: { title: 'Issue closed', body: '{outlet} closed {reference}.' },
  ISSUE_REOPENED: { title: 'Issue reopened', body: '{outlet} reopened {reference}.' },
  LICENCE_EXPIRING: { title: 'Licence expiring', body: '{licence} expires on {date}. Days left: {days}.' },
  LICENCE_EXPIRED: { title: 'Licence expired', body: '{licence} expired on {date}. Renew it and add the new copy.' },
  DOCUMENT_ADDED: { title: 'Documents updated', body: 'ECCS added or updated {title} in your licences and documents.' },
  DEVICE_LINKED: { title: 'New phone linked', body: 'A new phone was linked to {outlet}.' },
  PIN_LOCKED: { title: 'Wrong PIN five times', body: 'Someone tried a wrong PIN five times at {outlet}.' },
};

const CATEGORY: Record<IssueCategory, string> = {
  PEST_SIGHTING: 'Pest sighting',
  CHIMNEY: 'Chimney or exhaust',
  EQUIPMENT: 'Equipment',
  HYGIENE: 'Cleaning or hygiene',
  SUPPORT: 'Help with the app or service',
  OTHER: 'Something else',
};

const clock = (hhmm: string) => {
  const [hours, minutes] = hhmm.split(':').map(Number) as [number, number];
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(
    new Date(Date.UTC(2000, 0, 1, hours, minutes)),
  );
};

const englishFormatters = {
  text: (value: LocalizedText) => value.en ?? Object.values(value)[0] ?? '',
  date: (value: string) =>
    new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(
      new Date(`${value}T00:00:00Z`),
    ),
  slot: (value: string | null) => {
    const known = VISIT_SLOTS.find((slot) => slot === value);
    if (!known) return 'time to be confirmed';
    const window = visitSlotWindow(known);
    return window ? `${clock(window.start)} – ${clock(window.end)}` : 'After closing';
  },
  category: (value: string) => CATEGORY[value as IssueCategory] ?? value,
};

/** A notification's title and body in English, with its values filled in. */
export function wordInEnglish(
  type: NotificationType,
  params: Record<string, NotificationParamValue>,
): { title: string; body: string } {
  const values = notificationWordingParams(params, englishFormatters);
  const fill = (template: string) =>
    template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match)).trim();
  return { title: fill(ENGLISH[type].title), body: fill(ENGLISH[type].body) };
}
