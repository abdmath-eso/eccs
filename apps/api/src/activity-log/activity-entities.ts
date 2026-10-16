import {
  budgetTotal,
  FINANCE_LINE_LABELS,
  localize,
  mainRole,
  readBudgetLines,
  ROLE_LABELS,
  shortText,
  type FinanceLine,
  type LocalizedText,
  type Role,
} from '@eccs/shared';
import type { PrismaService } from '../prisma/prisma.service.js';

// How the activity log finds out what a record is: its outlet and restaurant, a short
// safe name and its reference. Run after the answer has gone (before, for a delete),
// so it never slows a request down. Only names of records are read here, never free
// text people typed (an issue's title, a note, an SOP's steps) and never anything
// about a staff member beyond which outlet they belong to.

export type EntityKind =
  | 'aiRequest'
  | 'attachment'
  | 'attendancePunch'
  | 'booking'
  | 'budget'
  | 'cashOpening'
  | 'expense'
  | 'founderMoney'
  | 'catalogItem'
  | 'certificate'
  | 'checklistItem'
  | 'checklistRun'
  | 'document'
  | 'foodItem'
  | 'foodLabel'
  | 'inspection'
  | 'invoice'
  | 'issue'
  | 'lead'
  | 'licence'
  | 'linkedDevice'
  | 'notification'
  | 'organization'
  | 'outlet'
  | 'outletChecklist'
  | 'payment'
  | 'plan'
  | 'publicPhoto'
  | 'quote'
  | 'serviceKind'
  | 'serviceTask'
  | 'sop'
  | 'sopLibraryItem'
  | 'staffMember'
  | 'staffPayEntry'
  | 'user'
  | 'visit';

/** Kinds that are the restaurant's staff data: only the outlet is ever taken from them. */
export const STAFF_ENTITY_KINDS: readonly EntityKind[] = ['staffMember', 'staffPayEntry', 'attendancePunch'];

export interface ResolvedEntity {
  label?: string | null;
  reference?: string | null;
  organizationId?: string | null;
  outletId?: string | null;
  details?: Record<string, unknown>;
}

type Db = PrismaService['client'];

const english = (text: unknown): string | null => {
  if (text == null) return null;
  if (typeof text === 'string') return shortText(text);
  const value = localize(text as LocalizedText, 'EN');
  return value ? shortText(value) : null;
};

export const issueReference = (value: number) => `ECCS-${String(value).padStart(4, '0')}`;

/**
 * Looks a record up. `action` lets a kind add facts only some actions need: a checklist
 * hand-in says how many items were reported as problems (never which, or why).
 */
export async function resolveEntity(db: Db, kind: EntityKind, id: string, action: string): Promise<ResolvedEntity | null> {
  switch (kind) {
    case 'checklistRun': {
      const run = await db.checklistRun.findUnique({
        where: { id },
        select: { outletId: true, status: true, outletChecklist: { select: { template: { select: { title: true } } } } },
      });
      if (!run) return null;
      const details: Record<string, unknown> = { status: run.status };
      if (action === 'checklists.run.submitted') {
        // Counts only: how many items were answered and how many were reported as problems.
        const [answered, problems] = await Promise.all([
          db.checklistResponse.count({ where: { runId: id } }),
          db.checklistResponse.count({ where: { runId: id, passed: false } }),
        ]);
        Object.assign(details, { answered, problems });
      }
      return { outletId: run.outletId, label: english(run.outletChecklist.template.title), details };
    }
    case 'outletChecklist': {
      const list = await db.outletChecklist.findUnique({ where: { id }, select: { outletId: true, template: { select: { title: true } } } });
      return list && { outletId: list.outletId, label: english(list.template.title) };
    }
    case 'checklistItem': {
      // The checklist's name, not the item's own words.
      const item = await db.checklistItem.findUnique({ where: { id }, select: { outletId: true, template: { select: { title: true, outletId: true } } } });
      return item && { outletId: item.outletId ?? item.template.outletId, label: english(item.template.title) };
    }
    case 'issue': {
      // The reference, never the title or the messages people typed.
      const issue = await db.issue.findUnique({ where: { id }, select: { outletId: true, reference: true, category: true, severity: true, status: true } });
      return (
        issue && {
          outletId: issue.outletId,
          reference: issueReference(issue.reference),
          label: issue.category,
          details: { status: issue.status, category: issue.category, severity: issue.severity },
        }
      );
    }
    case 'licence': {
      const licence = await db.licence.findUnique({ where: { id }, select: { outletId: true, type: true } });
      return licence && { outletId: licence.outletId, label: licence.type, details: { type: licence.type } };
    }
    case 'document': {
      const document = await db.document.findUnique({ where: { id }, select: { outletId: true, title: true, category: true } });
      return document && { outletId: document.outletId, label: shortText(document.title), details: { category: document.category } };
    }
    case 'attachment': {
      const attachment = await db.attachment.findUnique({
        where: { id },
        select: { outletId: true, kind: true, mimeType: true, documents: { select: { title: true, category: true }, take: 1 } },
      });
      if (!attachment) return null;
      const document = attachment.documents[0];
      return {
        outletId: attachment.outletId,
        label: document ? shortText(document.title) : null,
        details: { kind: attachment.kind, pdf: attachment.mimeType === 'application/pdf', ...(document && { category: document.category }) },
      };
    }
    case 'visit': {
      const visit = await db.job.findUnique({
        where: { id },
        select: { outletId: true, status: true, serviceType: { select: { name: true, code: true } }, serviceReport: { select: { number: true } } },
      });
      return (
        visit && {
          outletId: visit.outletId,
          label: english(visit.serviceType.name),
          reference: visit.serviceReport?.number ?? null,
          details: { status: visit.status, serviceCode: visit.serviceType.code },
        }
      );
    }
    case 'booking': {
      const booking = await db.booking.findUnique({ where: { id }, select: { outletId: true, status: true, catalogItem: { select: { name: true } } } });
      return booking && { outletId: booking.outletId, label: english(booking.catalogItem.name), details: { status: booking.status } };
    }
    case 'inspection': {
      const inspection = await db.inspection.findUnique({ where: { id }, select: { outletId: true, status: true, reportNumber: true, overallScore: true, grade: true } });
      return (
        inspection && {
          outletId: inspection.outletId,
          reference: inspection.reportNumber,
          label: 'Inspection',
          details: {
            status: inspection.status,
            ...(inspection.overallScore != null && { score: Math.round(inspection.overallScore * 10) / 10 }),
            ...(inspection.grade && { grade: inspection.grade }),
          },
        }
      );
    }
    case 'invoice': {
      const invoice = await db.invoice.findUnique({
        where: { id },
        select: { organizationId: true, outletId: true, number: true, status: true, totalPaise: true, paidPaise: true, subscriptionId: true },
      });
      return (
        invoice && {
          organizationId: invoice.organizationId,
          outletId: invoice.outletId,
          reference: invoice.number,
          label: invoice.subscriptionId ? 'Plan invoice' : 'Service invoice',
          details: { status: invoice.status, totalPaise: invoice.totalPaise, paidPaise: invoice.paidPaise },
        }
      );
    }
    case 'payment': {
      const payment = await db.payment.findUnique({
        where: { id },
        select: { amountPaise: true, method: true, status: true, invoice: { select: { number: true, organizationId: true, outletId: true } } },
      });
      return (
        payment && {
          organizationId: payment.invoice.organizationId,
          outletId: payment.invoice.outletId,
          reference: payment.invoice.number,
          label: 'Payment',
          details: { status: payment.status, amountPaise: payment.amountPaise, method: payment.method },
        }
      );
    }
    case 'certificate': {
      const certificate = await db.certificate.findUnique({ where: { id }, select: { outletId: true, number: true, serviceType: { select: { name: true } } } });
      return certificate && { outletId: certificate.outletId, reference: certificate.number, label: english(certificate.serviceType.name) };
    }
    case 'plan': {
      const plan = await db.plan.findUnique({ where: { id }, select: { code: true, name: true, pricePaise: true, isActive: true } });
      return plan && { label: english(plan.name), details: { planCode: plan.code, pricePaise: plan.pricePaise, offered: plan.isActive } };
    }
    case 'catalogItem': {
      const item = await db.serviceCatalogItem.findUnique({ where: { id }, select: { name: true, pricePaise: true, isActive: true } });
      return item && { label: english(item.name), details: { pricePaise: item.pricePaise, offered: item.isActive } };
    }
    case 'serviceKind': {
      const kind = await db.serviceType.findUnique({ where: { code: id }, select: { name: true, code: true, isActive: true } });
      return kind && { label: english(kind.name), details: { serviceCode: kind.code, offered: kind.isActive } };
    }
    case 'serviceTask': {
      // ECCS's own task wording for a kind of service.
      const task = await db.checklistItem.findUnique({ where: { id }, select: { label: true } });
      return task && { label: english(task.label) };
    }
    case 'sop': {
      const sop = await db.sopTemplate.findUnique({ where: { id }, select: { outletId: true, title: true } });
      return sop && { outletId: sop.outletId, label: english(sop.title), details: { ownSop: sop.outletId != null } };
    }
    case 'sopLibraryItem': {
      const item = await db.sopLibraryItem.findUnique({ where: { id }, select: { name: true } });
      return item && { label: shortText(item.name) };
    }
    case 'foodItem': {
      const item = await db.foodItem.findUnique({ where: { id }, select: { outletId: true, name: true, isActive: true } });
      return item && { outletId: item.outletId, label: english(item.name), details: { inUse: item.isActive } };
    }
    case 'foodLabel': {
      const label = await db.foodLabel.findUnique({ where: { id }, select: { outletId: true, itemName: true, copies: true } });
      return label && { outletId: label.outletId, label: label.itemName ? shortText(label.itemName) : null, details: { copies: label.copies } };
    }
    case 'publicPhoto': {
      const photo = await db.publicPhoto.findUnique({ where: { id }, select: { status: true, captionCode: true, source: true, profile: { select: { outletId: true } } } });
      return photo && { outletId: photo.profile.outletId, details: { status: photo.status, caption: photo.captionCode, origin: photo.source } };
    }
    case 'organization': {
      const organization = await db.organization.findUnique({ where: { id }, select: { id: true, name: true, isActive: true } });
      return organization && { organizationId: organization.id, label: shortText(organization.name), details: { active: organization.isActive } };
    }
    case 'outlet': {
      const outlet = await db.outlet.findUnique({ where: { id }, select: { id: true, name: true, organizationId: true, isActive: true } });
      return outlet && { organizationId: outlet.organizationId, outletId: outlet.id, label: shortText(outlet.name), details: { active: outlet.isActive } };
    }
    case 'linkedDevice': {
      // Not the phone's own name, which people may set to their own.
      const device = await db.linkedDevice.findUnique({ where: { id }, select: { organizationId: true, outletId: true } });
      return device && { organizationId: device.organizationId, outletId: device.outletId, label: 'Linked phone' };
    }
    case 'user': {
      const user = await db.user.findUnique({ where: { id }, select: { name: true, isActive: true, memberships: { select: { role: true, organizationId: true, outletId: true } } } });
      if (!user) return null;
      const role = mainRole(user.memberships.map((m) => m.role as Role));
      const place = user.memberships.find((m) => m.role === role);
      return {
        organizationId: place?.organizationId ?? null,
        outletId: place?.outletId ?? null,
        label: shortText(role ? `${user.name} (${ROLE_LABELS[role]})` : user.name),
        details: { role, active: user.isActive },
      };
    }
    case 'aiRequest': {
      const request = await db.aiRequest.findUnique({ where: { id }, select: { feature: true, organizationId: true, outletId: true } });
      return request && { organizationId: request.organizationId, outletId: request.outletId, label: request.feature };
    }
    case 'notification':
      return {};
    // ECCS's own books (the Finance page): the kind and the amount, never who was paid or what
    // was typed (a wage advance names a staff member).
    case 'expense': {
      const expense = await db.expense.findUnique({ where: { id }, select: { kind: true, category: true, type: true, amountPaise: true, paidOn: true, teamMemberId: true } });
      if (!expense) return null;
      // A team member's salary (the Team page, 16 Oct 2026) is pay: never its amount.
      if (expense.teamMemberId) return { label: 'Salary from Team', details: { kind: expense.kind, category: expense.category, paid: expense.paidOn !== null } };
      const advance = expense.kind === 'WAGE_ADVANCE';
      return {
        label: advance ? 'Wage advance' : FINANCE_LINE_LABELS[expense.category as FinanceLine] ?? expense.category,
        details: { kind: expense.kind, category: expense.category, type: expense.type, amountPaise: expense.amountPaise, paid: expense.paidOn !== null },
      };
    }
    case 'budget': {
      const budget = await db.budget.findUnique({ where: { id }, select: { name: true, lines: true } });
      return budget && { label: shortText(budget.name), details: { totalPaise: budgetTotal(readBudgetLines(budget.lines)) } };
    }
    case 'founderMoney': {
      const entry = await db.founderMoney.findUnique({ where: { id }, select: { direction: true, amountPaise: true } });
      return entry && { label: "Founders' money", details: { direction: entry.direction, amountPaise: entry.amountPaise } };
    }
    case 'cashOpening': {
      const opening = await db.cashOpening.findUnique({ where: { id }, select: { id: true } });
      return opening && { label: 'Opening cash balance' };
    }
    // Sales: the lead by its business name, its stage and where it came from; never the
    // contact's name or number, a note or a reason typed in. A quote by its number.
    case 'lead': {
      const lead = await db.lead.findUnique({ where: { id }, select: { businessName: true, stage: true, status: true, source: true, organizationId: true } });
      return lead && { organizationId: lead.organizationId, label: shortText(lead.businessName), details: { stage: lead.stage, status: lead.status, source: lead.source } };
    }
    case 'quote': {
      const quote = await db.quote.findUnique({
        where: { id },
        select: { number: true, status: true, totalPaise: true, openCount: true, lead: { select: { businessName: true, organizationId: true } } },
      });
      return (
        quote && {
          organizationId: quote.lead.organizationId,
          reference: quote.number,
          label: shortText(quote.lead.businessName),
          details: { status: quote.status, totalPaise: quote.totalPaise, openCount: quote.openCount },
        }
      );
    }
    // Staff data: which outlet, and nothing else.
    case 'staffMember': {
      const person = await db.staffMember.findUnique({ where: { id }, select: { outletId: true } });
      return person && { outletId: person.outletId };
    }
    case 'staffPayEntry': {
      const entry = await db.staffPayEntry.findUnique({ where: { id }, select: { staffMember: { select: { outletId: true } } } });
      return entry && { outletId: entry.staffMember.outletId };
    }
    case 'attendancePunch': {
      const punch = await db.attendancePunch.findUnique({ where: { id }, select: { outletId: true } });
      return punch && { outletId: punch.outletId };
    }
  }
}
