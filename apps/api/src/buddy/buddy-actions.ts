import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  addChecklistItemSchema,
  can,
  createBookingSchema,
  createChecklistSchema,
  createFoodItemSchema,
  createIssueSchema,
  createSopSchema,
  updateChecklistSchema,
  updateSopSchema,
  type Action,
  type ActivityAction,
  type BuddyAction,
  type BuddyOpenDto,
  type Resource,
} from '@eccs/shared';
import { z } from 'zod';
import { noteActivity } from '../activity-log/activity-context.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ChecklistsService } from '../checklists/checklists.service.js';
import { FoodLabelsService } from '../food-labels/food-labels.service.js';
import { IssuesService } from '../issues/issues.service.js';
import { ServicesService } from '../services/services.service.js';
import { SopsService } from '../sops/sops.service.js';

// Carrying out a confirmation card once the person has tapped it (ECCS Buddy, 16 Oct 2026). Each
// card goes through the app's own service, with the grant check of the app's own route and the
// route's own schema, again, now: whatever was true when the card was made is checked afresh (the
// person may have lost access, ECCS may have confirmed the booking, the checklist may be gone).
//
// The request is logged as the app's own action ("Booked a service", "Added an item to a
// checklist") with the detail through=buddy, so the Logs page shows it with everything else of
// its kind. The chat's words are never logged.

/** What a card did: where to see it, and what it made (an issue's reference). */
export interface BuddyActionDone {
  open: BuddyOpenDto;
  reference: string | null;
  entity: { type: string; id: string };
}

/** Each card's grant (the app route's @RequirePermission) and the action it is logged as. */
const RULES: Record<BuddyAction, { needs: [Resource, Action]; logAs: ActivityAction }> = {
  BOOK: { needs: ['bookings', 'create'], logAs: 'visits.booking.requested' },
  CANCEL_BOOKING: { needs: ['bookings', 'update'], logAs: 'visits.booking.cancelled' },
  ADD_CHECKLIST_ITEM: { needs: ['checklists', 'update'], logAs: 'checklists.setupItem.added' },
  ADD_CHECKLIST: { needs: ['checklists', 'update'], logAs: 'checklists.list.added' },
  CHECKLIST_DUE_TIME: { needs: ['checklists', 'update'], logAs: 'checklists.list.changed' },
  SAVE_SOP: { needs: ['sopTemplates', 'create'], logAs: 'sops.sop.added' },
  ADD_FOOD_LABEL: { needs: ['foodLabels', 'create'], logAs: 'foodLabels.item.added' },
  REPORT_ISSUE: { needs: ['issues', 'create'], logAs: 'issues.issue.raised' },
  ASK_ECCS: { needs: ['issues', 'create'], logAs: 'issues.issue.raised' },
};

const itemInput = z.object({ outletChecklistId: z.string().min(1) });
const dueInput = z.object({ outletChecklistId: z.string().min(1), dueTime: z.string().nullable() });
const cancelInput = z.object({ bookingId: z.string().min(1) });
const sopInput = z.object({ sopId: z.string().nullable().optional() });

@Injectable()
export class BuddyActions {
  constructor(
    private readonly services: ServicesService,
    private readonly checklists: ChecklistsService,
    private readonly sops: SopsService,
    private readonly labels: FoodLabelsService,
    private readonly issues: IssuesService,
  ) {}

  /**
   * Carries out one card as `user`. Throws the service's own refusal (403, 404, 409, 400), which
   * the caller keeps on the card in plain words so the person can try again.
   */
  async run(user: AuthUser, card: { action: string; input: unknown; outletId: string | null; organizationId: string | null }): Promise<BuddyActionDone> {
    const action = card.action as BuddyAction;
    const rule = RULES[action];
    if (!rule) throw new ForbiddenException('This card cannot be carried out');
    const sopChange = action === 'SAVE_SOP' && Boolean(sopInput.parse(card.input).sopId);
    // Logged as the app's own action, marked as done through Buddy. Noted first, so a refusal is logged as one too.
    noteActivity({
      action: sopChange ? 'sops.sop.changed' : rule.logAs,
      outletId: card.outletId,
      organizationId: card.organizationId,
      details: { through: 'buddy', buddyAction: action },
    });
    // The grant of the app's own route, for this outlet.
    const [resource, verb] = sopChange ? (['sopTemplates', 'update'] as [Resource, Action]) : rule.needs;
    if (!can(user.memberships, resource, verb, { organizationId: card.organizationId, outletId: card.outletId })) {
      throw new ForbiddenException('You cannot do this in the app any more');
    }
    const done = await this.carryOut(user, action, card.input);
    noteActivity({ entity: { type: done.entity.type, id: done.entity.id, reference: done.reference } });
    return done;
  }

  private async carryOut(user: AuthUser, action: BuddyAction, input: unknown): Promise<BuddyActionDone> {
    switch (action) {
      case 'BOOK': {
        const booking = await this.services.createBooking(user, createBookingSchema.parse(input));
        return { open: { target: 'services', params: {} }, reference: null, entity: { type: 'booking', id: booking.id } };
      }
      case 'CANCEL_BOOKING': {
        const booking = await this.services.cancelBooking(user, cancelInput.parse(input).bookingId);
        return { open: { target: 'services', params: {} }, reference: null, entity: { type: 'booking', id: booking.id } };
      }
      case 'ADD_CHECKLIST_ITEM': {
        const { outletChecklistId } = itemInput.parse(input);
        await this.checklists.addItem(user, outletChecklistId, addChecklistItemSchema.parse(input));
        return { open: { target: 'checklist_setup', params: {} }, reference: null, entity: { type: 'outletChecklist', id: outletChecklistId } };
      }
      case 'ADD_CHECKLIST': {
        const body = createChecklistSchema.parse(input);
        const lists = await this.checklists.createList(user, body);
        const made = lists.find((list) => list.isCustom && Object.values(list.title).includes(body.title)) ?? lists[lists.length - 1];
        return { open: { target: 'checklist_setup', params: {} }, reference: null, entity: { type: 'outletChecklist', id: made?.id ?? body.outletId } };
      }
      case 'CHECKLIST_DUE_TIME': {
        const { outletChecklistId, dueTime } = dueInput.parse(input);
        await this.checklists.updateList(user, outletChecklistId, updateChecklistSchema.parse({ dueTime }));
        return { open: { target: 'checklist_setup', params: {} }, reference: null, entity: { type: 'outletChecklist', id: outletChecklistId } };
      }
      case 'SAVE_SOP': {
        const { sopId } = sopInput.parse(input);
        const body = createSopSchema.parse(input);
        const sop = sopId
          ? await this.sops.update(user, sopId, updateSopSchema.parse({ category: body.category, title: body.title, steps: body.steps }))
          : await this.sops.create(user, body);
        return { open: { target: 'sop', params: { sopId: sop.id } }, reference: null, entity: { type: 'sop', id: sop.id } };
      }
      case 'ADD_FOOD_LABEL': {
        const item = await this.labels.createItem(user, createFoodItemSchema.parse(input));
        return { open: { target: 'labels', params: {} }, reference: null, entity: { type: 'foodItem', id: item.id } };
      }
      case 'REPORT_ISSUE':
      case 'ASK_ECCS': {
        const issue = await this.issues.create(user, createIssueSchema.parse(input));
        return { open: { target: 'issue', params: { issueId: issue.id } }, reference: issue.reference, entity: { type: 'issue', id: issue.id } };
      }
    }
  }
}
