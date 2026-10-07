import { Injectable, Logger } from '@nestjs/common';
import {
  isEccsRole,
  LOW_RATING_STARS,
  NOTIFICATION_EXCERPT_LENGTH,
  VISIT_SLOTS,
  type IssueStatus,
  type LocalizedText,
  type NotificationLink,
  type Role,
  type VisitSlot,
} from '@eccs/shared';
import { env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from './notifications.service.js';

/** Whoever did the thing being announced. They are not told about it themselves. */
export interface Actor {
  id: string;
  memberships: readonly { role: Role }[];
}

/** A visit as it stood before ECCS changed it, to tell what changed. */
interface VisitBefore {
  id: string;
  scheduledDate: Date;
  scheduledSlot: string | null;
  supervisorId: string | null;
}

export const isoDate = (date: Date) => date.toISOString().slice(0, 10);
export const toSlot = (slot: string | null): VisitSlot | null => VISIT_SLOTS.find((known) => known === slot) ?? null;

/** The first words of something a person typed, for quoting in a notification. */
const excerpt = (text: string) => {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > NOTIFICATION_EXCERPT_LENGTH ? `${oneLine.slice(0, NOTIFICATION_EXCERPT_LENGTH - 1)}…` : oneLine;
};

const issueReference = (value: number) => `ECCS-${String(value).padStart(4, '0')}`;

const fromEccs = (actor: Actor) => actor.memberships.some((m) => isEccsRole(m.role));

const OWNER_AND_MANAGER = ['OWNER', 'MANAGER'] as const;

/**
 * Tells people about things that have just happened. The other parts of the
 * API call one method here after their own work has succeeded; each method
 * works out who should know (docs/NOTIFICATIONS.md says who) and what to say.
 *
 * A notification is a courtesy, never part of the action: every method here
 * catches its own errors, so a booking is still confirmed and a visit still
 * finished if telling people about it fails.
 */
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);

  /**
   * Off while the automated tests run, so that they do not fill the sample
   * people's lists; the notifications tests switch it on for themselves.
   */
  enabled = env.NODE_ENV !== 'test';

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  private async quietly(what: string, work: () => Promise<unknown>): Promise<void> {
    if (!this.enabled) return;
    try {
      await work();
    } catch (error) {
      this.logger.warn(`Could not send the "${what}" notification: ${String(error)}`);
    }
  }

  private managersOf(outletId: string) {
    return this.notifications.restaurantPeople(outletId, OWNER_AND_MANAGER);
  }

  private visit(visitId: string) {
    return this.db.job.findUnique({
      where: { id: visitId },
      include: {
        outlet: { select: { id: true, name: true } },
        serviceType: { select: { name: true } },
        serviceReport: { select: { number: true } },
        signOff: { select: { rating: true, comment: true } },
      },
    });
  }

  // ───────────────────────── Bookings and visits ─────────────────────────

  /** S2: a restaurant asked for a service. */
  bookingRequested(actor: Actor, bookingId: string) {
    return this.quietly('booking requested', async () => {
      const booking = await this.db.booking.findUnique({
        where: { id: bookingId },
        include: { outlet: { select: { id: true, name: true } }, catalogItem: { select: { name: true } } },
      });
      if (!booking) return;
      await this.notifications.send(
        await this.notifications.admins(),
        'BOOKING_REQUESTED',
        {
          outlet: booking.outlet.name,
          service: booking.catalogItem.name as LocalizedText,
          date: isoDate(booking.preferredDate),
          slot: toSlot(booking.preferredSlot),
        },
        { kind: 'services', outletId: booking.outlet.id },
        { except: actor.id },
      );
    });
  }

  /** S3 and S7: ECCS confirmed a request, which put a visit in the diary. */
  bookingConfirmed(actor: Actor, bookingId: string) {
    return this.quietly('booking confirmed', async () => {
      const job = await this.db.job.findUnique({ where: { bookingId }, select: { id: true } });
      const visit = job && (await this.visit(job.id));
      if (!visit) return;
      const params = {
        outlet: visit.outlet.name,
        service: visit.serviceType.name as LocalizedText,
        date: isoDate(visit.scheduledDate),
        slot: toSlot(visit.scheduledSlot),
      };
      const link: NotificationLink = { kind: 'visit', visitId: visit.id };
      await this.notifications.send(await this.managersOf(visit.outlet.id), 'BOOKING_CONFIRMED', params, link, { except: actor.id });
      await this.notifications.send([visit.supervisorId], 'VISIT_ASSIGNED', params, link, { except: actor.id });
    });
  }

  /**
   * S4 and S6: ECCS turned a request down, or cancelled the visit a request had
   * become. A restaurant withdrawing its own request tells nobody.
   */
  bookingCancelled(actor: Actor, bookingId: string, was: { confirmed: boolean }) {
    return this.quietly('booking cancelled', async () => {
      if (!fromEccs(actor)) return;
      const booking = await this.db.booking.findUnique({
        where: { id: bookingId },
        include: {
          outlet: { select: { id: true, name: true } },
          catalogItem: { select: { name: true } },
          job: { select: { id: true, scheduledDate: true, supervisorId: true } },
        },
      });
      if (!booking) return;
      const service = booking.catalogItem.name as LocalizedText;
      const managers = await this.managersOf(booking.outlet.id);
      if (was.confirmed && booking.job) {
        await this.notifications.send(
          [...managers, booking.job.supervisorId],
          'VISIT_CANCELLED',
          { outlet: booking.outlet.name, service, date: isoDate(booking.job.scheduledDate) },
          { kind: 'visit', visitId: booking.job.id },
          { except: actor.id },
        );
      } else {
        await this.notifications.send(
          managers,
          'BOOKING_DECLINED',
          { outlet: booking.outlet.name, service, date: isoDate(booking.preferredDate) },
          { kind: 'services', outletId: booking.outlet.id },
          { except: actor.id },
        );
      }
    });
  }

  /** S7: ECCS put a visit in the diary itself and gave it to a Supervisor. */
  visitCreated(actor: Actor, visitId: string) {
    return this.quietly('visit created', async () => {
      const visit = await this.visit(visitId);
      if (!visit?.supervisorId) return;
      await this.notifications.send(
        [visit.supervisorId],
        'VISIT_ASSIGNED',
        {
          outlet: visit.outlet.name,
          service: visit.serviceType.name as LocalizedText,
          date: isoDate(visit.scheduledDate),
          slot: toSlot(visit.scheduledSlot),
        },
        { kind: 'visit', visitId: visit.id },
        { except: actor.id },
      );
    });
  }

  /** S5 and S7: ECCS moved a visit, or changed who does it. `before` is the visit as it was. */
  visitChanged(actor: Actor, before: VisitBefore) {
    return this.quietly('visit changed', async () => {
      const visit = await this.visit(before.id);
      if (!visit) return;
      const outlet = visit.outlet.name;
      const service = visit.serviceType.name as LocalizedText;
      const date = isoDate(visit.scheduledDate);
      const slot = toSlot(visit.scheduledSlot);
      const link: NotificationLink = { kind: 'visit', visitId: visit.id };
      const moved = date !== isoDate(before.scheduledDate) || visit.scheduledSlot !== before.scheduledSlot;
      const sameSupervisor = visit.supervisorId === before.supervisorId;

      if (moved) {
        await this.notifications.send(
          // A Supervisor who has only just been given the visit hears about it below, with its new time.
          [...(await this.managersOf(visit.outlet.id)), sameSupervisor ? visit.supervisorId : null],
          'VISIT_MOVED',
          { outlet, service, date, slot },
          link,
          { except: actor.id },
        );
      }
      if (!sameSupervisor) {
        await this.notifications.send(
          [before.supervisorId],
          'VISIT_UNASSIGNED',
          // The day it was theirs, which is the day they had planned for.
          { outlet, service, date: isoDate(before.scheduledDate) },
          null,
          { except: actor.id },
        );
        await this.notifications.send([visit.supervisorId], 'VISIT_ASSIGNED', { outlet, service, date, slot }, link, {
          except: actor.id,
        });
      }
    });
  }

  /** S6: ECCS called a visit off. */
  visitCancelled(actor: Actor, visitId: string) {
    return this.quietly('visit cancelled', async () => {
      const visit = await this.visit(visitId);
      if (!visit) return;
      await this.notifications.send(
        [...(await this.managersOf(visit.outlet.id)), visit.supervisorId],
        'VISIT_CANCELLED',
        { outlet: visit.outlet.name, service: visit.serviceType.name as LocalizedText, date: isoDate(visit.scheduledDate) },
        { kind: 'visit', visitId: visit.id },
        { except: actor.id },
      );
    });
  }

  /** S10: the Supervisor checked in at the outlet. */
  visitStarted(actor: Actor, visitId: string) {
    return this.quietly('visit started', async () => {
      const visit = await this.visit(visitId);
      if (!visit) return;
      await this.notifications.send(
        await this.managersOf(visit.outlet.id),
        'VISIT_STARTED',
        { outlet: visit.outlet.name, service: visit.serviceType.name as LocalizedText },
        { kind: 'visit', visitId: visit.id },
        { except: actor.id },
      );
    });
  }

  /** S11: the Supervisor finished, and the restaurant is to check the work and sign off. */
  visitFinished(actor: Actor, visitId: string) {
    return this.quietly('visit finished', async () => {
      const visit = await this.visit(visitId);
      // A report corrected after the restaurant had signed it off goes back to ECCS; the restaurant has nothing to do.
      if (!visit || visit.status !== 'COMPLETED') return;
      await this.notifications.send(
        await this.managersOf(visit.outlet.id),
        'VISIT_FINISHED',
        { outlet: visit.outlet.name, service: visit.serviceType.name as LocalizedText },
        { kind: 'visit', visitId: visit.id },
        { except: actor.id },
      );
    });
  }

  /**
   * S13 and S14: the restaurant signed off. ECCS's admins and the visit's
   * Supervisor are told; for one or two stars the admins get the low-rating
   * notification, with the comment, in place of the ordinary one.
   */
  visitSignedOff(actor: Actor, visitId: string) {
    return this.quietly('visit signed off', async () => {
      const visit = await this.visit(visitId);
      if (!visit?.signOff) return;
      const outlet = visit.outlet.name;
      const service = visit.serviceType.name as LocalizedText;
      const stars = visit.signOff.rating ?? 0;
      const link: NotificationLink = { kind: 'visit', visitId: visit.id };
      const admins = await this.notifications.admins();
      const low = stars > 0 && stars <= LOW_RATING_STARS;

      if (low) {
        await this.notifications.send(
          admins,
          'VISIT_LOW_RATING',
          { outlet, service, stars, comment: visit.signOff.comment ? `"${excerpt(visit.signOff.comment)}"` : '' },
          link,
          { except: actor.id },
        );
      }
      // An admin who did the visit themselves has already been told, by the low-rating notification.
      const supervisor = visit.supervisorId && admins.includes(visit.supervisorId) ? null : visit.supervisorId;
      await this.notifications.send(
        low ? [supervisor] : [...admins, visit.supervisorId],
        'VISIT_SIGNED_OFF',
        { outlet, service, stars },
        link,
        { except: actor.id },
      );
    });
  }

  /** S1: ECCS approved a signed-off report, so the Owner and Manager can open its PDF. */
  reportApproved(actor: Actor, visitId: string) {
    return this.quietly('report ready', async () => {
      const visit = await this.visit(visitId);
      if (!visit?.serviceReport) return;
      await this.notifications.send(
        await this.managersOf(visit.outlet.id),
        'REPORT_READY',
        { outlet: visit.outlet.name, service: visit.serviceType.name as LocalizedText, reportNumber: visit.serviceReport.number },
        { kind: 'visit', visitId: visit.id },
        { except: actor.id },
      );
    });
  }

  /** S15: ECCS sent a report back to the Supervisor, saying what to correct. */
  reportReturned(actor: Actor, visitId: string) {
    return this.quietly('report returned', async () => {
      const visit = await this.visit(visitId);
      if (!visit) return;
      await this.notifications.send(
        [visit.supervisorId],
        'REPORT_RETURNED',
        { outlet: visit.outlet.name, service: visit.serviceType.name as LocalizedText, note: visit.reviewNote ?? '' },
        { kind: 'visit', visitId: visit.id },
        { except: actor.id },
      );
    });
  }

  // ───────────────────────── Plans ─────────────────────────

  /**
   * S18 and S7: visits were added to the diary from plans. Admins are told how
   * many still need a Supervisor; a Supervisor is told of each visit that came
   * with their name on it. `actorId` is the admin who set the plan, if one did.
   */
  planVisitsAdded(actorId: string | null | undefined, visitIds: string[]) {
    return this.quietly('plan visits added', async () => {
      if (visitIds.length === 0) return;
      const visits = await this.db.job.findMany({
        where: { id: { in: visitIds } },
        include: { outlet: { select: { name: true } }, serviceType: { select: { name: true } } },
      });
      const unassigned = visits.filter((visit) => !visit.supervisorId).length;
      if (unassigned > 0) {
        await this.notifications.send(
          await this.notifications.admins(),
          'PLAN_VISITS_UNASSIGNED',
          { count: unassigned },
          { kind: 'services' },
          { except: actorId },
        );
      }
      for (const visit of visits) {
        await this.notifications.send(
          [visit.supervisorId],
          'VISIT_ASSIGNED',
          {
            outlet: visit.outlet.name,
            service: visit.serviceType.name as LocalizedText,
            date: isoDate(visit.scheduledDate),
            slot: toSlot(visit.scheduledSlot),
          },
          { kind: 'visit', visitId: visit.id },
          { except: actorId },
        );
      }
    });
  }

  /** S19: ECCS put an outlet on a plan, or changed its plan. */
  planStarted(actor: Actor, outletId: string) {
    return this.quietly('plan started', async () => {
      const subscription = await this.db.subscription.findFirst({
        where: { outletId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        include: { outlet: { select: { name: true } }, plan: { select: { name: true } } },
      });
      if (!subscription) return;
      const first = await this.db.job.findFirst({
        where: { schedule: { subscriptionId: subscription.id }, status: { not: 'CANCELLED' } },
        orderBy: { scheduledDate: 'asc' },
        select: { scheduledDate: true },
      });
      await this.notifications.send(
        await this.managersOf(outletId),
        'PLAN_STARTED',
        {
          outlet: subscription.outlet.name,
          plan: subscription.plan.name as LocalizedText,
          date: isoDate(first?.scheduledDate ?? subscription.startDate),
        },
        { kind: 'services', outletId },
        { except: actor.id },
      );
    });
  }

  /** S19: ECCS took an outlet off its plan. `subscriptionIds` are the plans that were stopped. */
  planEnded(actor: Actor, subscriptionIds: string[]) {
    return this.quietly('plan ended', async () => {
      const subscriptions = await this.db.subscription.findMany({
        where: { id: { in: subscriptionIds } },
        include: { outlet: { select: { id: true, name: true } }, plan: { select: { name: true } } },
      });
      for (const subscription of subscriptions) {
        await this.notifications.send(
          await this.managersOf(subscription.outlet.id),
          'PLAN_ENDED',
          { outlet: subscription.outlet.name, plan: subscription.plan.name as LocalizedText },
          { kind: 'services', outletId: subscription.outlet.id },
          { except: actor.id },
        );
      }
    });
  }

  // ───────────────────────── Issues ─────────────────────────

  private issue(issueId: string) {
    return this.db.issue.findUnique({ where: { id: issueId }, include: { outlet: { select: { id: true, name: true } } } });
  }

  /** ECCS's side of an issue: the admins, and Supervisors who have visits at that outlet (they can see its issues). */
  private async eccsPeopleFor(outletId: string): Promise<string[]> {
    const supervisors = await this.db.job.findMany({
      where: { outletId, supervisorId: { not: null }, supervisor: { isActive: true } },
      distinct: ['supervisorId'],
      select: { supervisorId: true },
    });
    return [...(await this.notifications.admins()), ...supervisors.flatMap((job) => (job.supervisorId ? [job.supervisorId] : []))];
  }

  /** The restaurant's side of an issue: whoever raised it, and the outlet's Owner and Manager. */
  private async restaurantPeopleFor(issue: { outletId: string; raisedById: string }): Promise<string[]> {
    return [issue.raisedById, ...(await this.managersOf(issue.outletId))];
  }

  /** I1: a restaurant raised an issue with ECCS. */
  issueRaised(actor: Actor, issueId: string) {
    return this.quietly('issue raised', async () => {
      const issue = await this.issue(issueId);
      if (!issue) return;
      await this.notifications.send(
        await this.eccsPeopleFor(issue.outletId),
        'ISSUE_RAISED',
        {
          outlet: issue.outlet.name,
          reference: issueReference(issue.reference),
          category: issue.category,
          excerpt: excerpt(issue.description ?? issue.title),
        },
        { kind: 'issue', issueId: issue.id },
        { except: actor.id },
      );
    });
  }

  /** I2 and I3: someone replied on an issue; the other side is told. */
  issueReplied(actor: Actor, issueId: string, body: string) {
    return this.quietly('issue reply', async () => {
      const issue = await this.issue(issueId);
      if (!issue) return;
      const eccs = fromEccs(actor);
      await this.notifications.send(
        eccs ? await this.restaurantPeopleFor(issue) : await this.eccsPeopleFor(issue.outletId),
        eccs ? 'ISSUE_REPLY_ECCS' : 'ISSUE_REPLY_RESTAURANT',
        { outlet: issue.outlet.name, reference: issueReference(issue.reference), excerpt: excerpt(body) },
        { kind: 'issue', issueId: issue.id },
        { except: actor.id },
      );
    });
  }

  /**
   * I4 and I5: an issue's status changed. ECCS marking it in progress or
   * resolved is told to the restaurant; the restaurant closing or reopening it
   * is told to ECCS. `previous` is the status it had before.
   */
  issueStatusChanged(actor: Actor, issueId: string, previous: IssueStatus) {
    return this.quietly('issue status', async () => {
      const issue = await this.issue(issueId);
      if (!issue || issue.status === previous) return;
      const params = { outlet: issue.outlet.name, reference: issueReference(issue.reference) };
      const link: NotificationLink = { kind: 'issue', issueId: issue.id };
      if (fromEccs(actor)) {
        const type = issue.status === 'IN_PROGRESS' ? 'ISSUE_IN_PROGRESS' : issue.status === 'RESOLVED' ? 'ISSUE_RESOLVED' : null;
        if (type) await this.notifications.send(await this.restaurantPeopleFor(issue), type, params, link, { except: actor.id });
      } else {
        const type = issue.status === 'CLOSED' ? 'ISSUE_CLOSED' : issue.status === 'OPEN' ? 'ISSUE_REOPENED' : null;
        if (type) await this.notifications.send(await this.eccsPeopleFor(issue.outletId), type, params, link, { except: actor.id });
      }
    });
  }

  // ───────────────────────── Licences and documents ─────────────────────────

  /** L3: ECCS added or replaced a licence or a document for an outlet. The restaurant's own changes tell nobody. */
  documentChanged(actor: Actor, outletId: string, title: string) {
    return this.quietly('document added', async () => {
      if (!fromEccs(actor)) return;
      const outlet = await this.db.outlet.findUnique({ where: { id: outletId }, select: { name: true } });
      if (!outlet) return;
      await this.notifications.send(
        await this.managersOf(outletId),
        'DOCUMENT_ADDED',
        { outlet: outlet.name, title },
        { kind: 'documents', outletId },
        { except: actor.id },
      );
    });
  }

  // ───────────────────────── Checklists ─────────────────────────

  /** C3: a checklist was handed in with a problem reported on it. */
  checklistSubmitted(actor: Actor & { name: string }, runId: string) {
    return this.quietly('checklist problem', async () => {
      const run = await this.db.checklistRun.findUnique({
        where: { id: runId },
        include: {
          outlet: { select: { name: true } },
          outletChecklist: { select: { template: { select: { title: true } } } },
          responses: { where: { passed: false }, include: { item: { select: { label: true, position: true, isActive: true } } } },
        },
      });
      // An item removed from the checklist after it was answered is no longer part of what was handed in.
      const problems = run?.responses.filter((response) => response.item.isActive) ?? [];
      const first = problems.sort((a, b) => a.item.position - b.item.position)[0];
      if (!run || !first) return;
      await this.notifications.send(
        await this.managersOf(run.outletId),
        'CHECKLIST_PROBLEM',
        {
          outlet: run.outlet.name,
          name: actor.name,
          checklist: run.outletChecklist.template.title as LocalizedText,
          item: first.item.label as LocalizedText,
        },
        { kind: 'checklist', outletId: run.outletId, runId: run.id },
        { except: actor.id },
      );
    });
  }

  // ───────────────────────── Logins ─────────────────────────

  /** A1: a phone was linked with an outlet's restaurant code. Nobody is logged in yet, so there is nobody to leave out. */
  deviceLinked(outletId: string) {
    return this.quietly('phone linked', async () => {
      const outlet = await this.db.outlet.findUnique({ where: { id: outletId }, select: { name: true } });
      if (!outlet) return;
      await this.notifications.send(await this.managersOf(outletId), 'DEVICE_LINKED', { outlet: outlet.name }, { kind: 'staff' });
    });
  }

  /** A2: a phone was locked after five wrong PINs. An Owner's own phone belongs to the brand, not to one outlet. */
  pinLocked(device: { organizationId: string; outletId: string | null }) {
    return this.quietly('PIN locked', async () => {
      const [outlet, organization] = await Promise.all([
        device.outletId ? this.db.outlet.findUnique({ where: { id: device.outletId }, select: { name: true } }) : null,
        this.db.organization.findUnique({ where: { id: device.organizationId }, select: { name: true } }),
      ]);
      const people = device.outletId ? await this.managersOf(device.outletId) : await this.notifications.owners(device.organizationId);
      await this.notifications.send(people, 'PIN_LOCKED', { outlet: outlet?.name ?? organization?.name ?? '' }, { kind: 'staff' });
    });
  }
}
