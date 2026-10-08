import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  accessScope,
  amountInWords,
  calculateGst,
  can,
  ECCS_STATE_CODE,
  invoiceDueDate,
  invoiceNumber,
  invoiceNumberPrefix,
  invoiceOverdueDays,
  type BillingTotalsDto,
  type ClientDuesDto,
  type DuesDto,
  type DuesLineDto,
  type InvoiceBillTo,
  type InvoiceDto,
  type InvoiceStatus,
  type InvoiceSummaryDto,
  type LocalizedText,
  type OutletDuesDto,
  type PaymentDto,
  type PaymentResultDto,
  type PaymentSessionDto,
  type PaymentStatus,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { indiaDate } from '../checklists/checklists.service.js';
import { env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { InvoicePdfService } from './invoice-pdf.service.js';
import { PAYMENT_GATEWAY, type PaymentGateway } from './payment-gateway.js';

const MAX_LISTED = 500;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
// After the subscriptions' own check (about 35 seconds after start), which moves each one to its next cycle first.
const FIRST_CHECK_AFTER_MS = 50_000;

// Any fixed number: it names the one lock that issuing an invoice waits for, so two
// invoices are never given the same number, or raised for the same thing, at the same moment.
const ISSUE_LOCK = 710_261_008;

const UNPAID = ['ISSUED', 'PARTIALLY_PAID'] as const;

const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);
const english = (text: unknown) => {
  const localized = (text ?? {}) as LocalizedText;
  return localized.en ?? Object.values(localized)[0] ?? '';
};
/** A calendar day, e.g. "8 Oct 2026", for the wording of an invoice line. */
const shortDay = (date: Date) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(date);
const rupees = (paise: number) =>
  `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100)}`;

const invoiceInclude = {
  organization: { select: { name: true } },
  outlet: { select: { name: true } },
  lines: true,
  payments: { orderBy: { createdAt: 'desc' } },
  booking: { select: { job: { select: { id: true } } } },
} as const satisfies Prisma.InvoiceInclude;

type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;
type Tx = Prisma.TransactionClient;

/** One line of an invoice about to be raised. Prices are before GST. */
interface NewLine {
  description: string;
  sacCode: string;
  quantity: number;
  unitPricePaise: number;
  gstRatePercent: number;
}

/** What an invoice is raised for. Exactly one of the two is given. */
type Subject =
  | { subscriptionId: string; periodStart: Date; periodEnd: Date }
  | { bookingId: string };

/**
 * Billing: GST invoices, what is due, and payments.
 *
 * An invoice is raised by the server itself, already issued: one for each
 * cycle of an outlet's plan (in advance, see `billDue`), and one for a booked
 * one-time visit when ECCS approves its report (`billOnApproval`). Visits that
 * belong to a plan are covered by the plan's invoice and are never invoiced
 * one by one. An invoice is never deleted: a wrong one is made void, keeps its
 * number, and the same thing can then be invoiced again.
 *
 * Who may do what follows the "invoices" and "payments" rows of the
 * permission table: the Owner reads and pays, the Manager reads the invoices
 * of their own outlet, the Head Chef and the Supervisor nothing, ECCS admins
 * everything.
 *
 * This service reads plans and subscriptions and never changes them.
 */
@Injectable()
export class BillingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly pdfs: InvoicePdfService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** Raises the invoices that are due shortly after the server starts and a few times a day after that. */
  onModuleInit() {
    // Tests raise invoices themselves, at moments they choose.
    if (env.NODE_ENV === 'test') return;
    const check = () =>
      void this.billDue()
        .then(({ raised }) => raised > 0 && this.logger.log(`Raised ${raised} plan invoices`))
        .catch((error) => this.logger.warn(`Could not raise the invoices that are due: ${String(error)}`));
    const first = setTimeout(check, FIRST_CHECK_AFTER_MS);
    const repeat = setInterval(check, CHECK_EVERY_MS);
    // Neither keeps the server alive when it is asked to stop.
    first.unref();
    repeat.unref();
    this.timers = [first, repeat];
  }

  onModuleDestroy() {
    for (const timer of this.timers) clearTimeout(timer);
  }

  // ───────────────────────── Raising invoices ─────────────────────────

  /**
   * Raises the invoice of every active plan whose current cycle has begun (on
   * or before `asOf`: today, unless a test says otherwise) and has no invoice
   * yet. A void invoice does not count, so a cycle whose invoice was made void
   * is invoiced again. Safe to run as often as wanted. `outletId` narrows it
   * to one outlet's plan.
   */
  async billDue(asOf: string = indiaDate(), outletId?: string): Promise<{ raised: number; invoiceIds: string[] }> {
    const due = await this.db.subscription.findMany({
      where: { status: 'ACTIVE', currentPeriodStart: { lte: toDbDate(asOf) }, ...(outletId && { outletId }) },
      select: { id: true },
    });
    const invoiceIds: string[] = [];
    for (const subscription of due) {
      try {
        const raised = await this.raiseForSubscription(subscription.id, asOf);
        if (raised?.created) invoiceIds.push(raised.id);
      } catch (error) {
        // One plan that cannot be invoiced must not hold up the others.
        this.logger.warn(`Could not raise the invoice for subscription ${subscription.id}: ${String(error)}`);
      }
    }
    return { raised: invoiceIds.length, invoiceIds };
  }

  /**
   * The same for one subscription: the id of the invoice of its current
   * cycle, raised now if it was due and not there yet; null when nothing is
   * due (not active, the cycle has not begun, or no price is set).
   */
  async billSubscription(subscriptionId: string, asOf: string = indiaDate()): Promise<string | null> {
    return (await this.raiseForSubscription(subscriptionId, asOf))?.id ?? null;
  }

  /**
   * Called when ECCS approves a visit's report. A booked one-time visit is
   * invoiced now; a plan's visit is not (the plan's invoice covers it).
   *
   * It never throws: an invoice that could not be raised must not undo or fail
   * the approval. The reason is logged and `billVisit` can simply be called again.
   */
  async billOnApproval(visitId: string): Promise<void> {
    try {
      await this.billVisit(visitId);
    } catch (error) {
      this.logger.warn(`Could not raise the invoice for visit ${visitId}: ${String(error)}`);
    }
  }

  /**
   * The id of the visit's invoice, raised now if it is due and not there yet;
   * null when this visit gets none. One visit never gets two, however many
   * times this is called.
   */
  async billVisit(visitId: string): Promise<string | null> {
    const visit = await this.db.job.findUnique({
      where: { id: visitId },
      select: {
        id: true,
        outletId: true,
        status: true,
        reviewedAt: true,
        scheduleId: true,
        scheduledDate: true,
        checkInAt: true,
        outlet: { select: { name: true, organizationId: true } },
        serviceReport: { select: { number: true } },
        serviceType: { select: { sacCode: true, gstRatePercent: true } },
        booking: { select: { id: true, catalogItem: { select: { name: true, pricePaise: true } } } },
      },
    });
    // Only a signed-off visit whose report ECCS has approved.
    if (!visit || visit.status !== 'APPROVED' || !visit.reviewedAt) return null;
    // A plan's visit is paid for by the plan. A visit ECCS added itself, with no booking, has no agreed price to invoice.
    if (visit.scheduleId || !visit.booking) return null;
    const price = visit.booking.catalogItem.pricePaise;
    if (price <= 0) return null;

    const doneOn = visit.checkInAt ? toDbDate(indiaDate(visit.checkInAt)) : visit.scheduledDate;
    const report = visit.serviceReport?.number;
    const raised = await this.issue({
      organizationId: visit.outlet.organizationId,
      outletId: visit.outletId,
      subject: { bookingId: visit.booking.id },
      issueDate: indiaDate(),
      lines: [
        {
          description: [
            `${english(visit.booking.catalogItem.name)} at ${visit.outlet.name}`,
            `visit on ${shortDay(doneOn)}`,
            report ? `service report ${report}` : null,
          ]
            .filter(Boolean)
            .join(', '),
          sacCode: visit.serviceType.sacCode,
          quantity: 1,
          unitPricePaise: price,
          gstRatePercent: visit.serviceType.gstRatePercent,
        },
      ],
    });
    return raised.id;
  }

  /** `period` is given only when raising again for a cycle whose invoice was made void; otherwise the current cycle is used. */
  private async raiseForSubscription(
    subscriptionId: string,
    asOf: string,
    period?: { start: Date; end: Date },
  ): Promise<{ id: string; created: boolean } | null> {
    const subscription = await this.db.subscription.findUnique({
      where: { id: subscriptionId },
      select: {
        id: true,
        status: true,
        outletId: true,
        pricePaise: true,
        billingCycle: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        outlet: { select: { name: true, organizationId: true } },
        plan: {
          select: {
            name: true,
            lines: { select: { serviceType: { select: { sacCode: true, gstRatePercent: true } } } },
          },
        },
      },
    });
    if (!subscription) return null;
    const start = period?.start ?? subscription.currentPeriodStart;
    const end = period?.end ?? subscription.currentPeriodEnd;
    if (!start || !end || !subscription.pricePaise || subscription.pricePaise <= 0) return null;
    if (!period && (subscription.status !== 'ACTIVE' || fromDbDate(start) > asOf)) return null;

    // A plan is one price for several services, so it is one line. Its tax code and rate are
    // those of the plan's service taxed highest (they are all 18% today), which is how GST
    // treats services sold together for one price.
    const services = subscription.plan.lines.map((line) => line.serviceType);
    const taxedAs = [...services].sort((a, b) => b.gstRatePercent - a.gstRatePercent)[0];
    if (!taxedAs) return null;

    const cycle = { MONTHLY: 'monthly', QUARTERLY: 'quarterly', ANNUAL: 'annual' }[subscription.billingCycle ?? 'MONTHLY'];
    return this.issue({
      organizationId: subscription.outlet.organizationId,
      outletId: subscription.outletId,
      subject: { subscriptionId: subscription.id, periodStart: start, periodEnd: end },
      issueDate: asOf,
      lines: [
        {
          description: `${english(subscription.plan.name)} plan (${cycle}) at ${subscription.outlet.name}, ${shortDay(start)} to ${shortDay(end)}`,
          sacCode: taxedAs.sacCode,
          quantity: 1,
          unitPricePaise: subscription.pricePaise,
          gstRatePercent: taxedAs.gstRatePercent,
        },
      ],
    });
  }

  /**
   * Writes the invoice, already issued, unless the same thing already has one
   * that is not void. Everything that could collide (the check for an
   * existing invoice, and taking the next number) happens behind one lock.
   */
  private async issue(input: {
    organizationId: string;
    outletId: string;
    subject: Subject;
    issueDate: string;
    lines: NewLine[];
  }): Promise<{ id: string; created: boolean }> {
    const { subject } = input;
    const same: Prisma.InvoiceWhereInput =
      'bookingId' in subject
        ? { bookingId: subject.bookingId }
        : { subscriptionId: subject.subscriptionId, periodStart: subject.periodStart };

    const result = await this.db.$transaction(async (tx) => {
      // One at a time, until this transaction ends: see ISSUE_LOCK.
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${ISSUE_LOCK})`);

      const existing = await tx.invoice.findFirst({ where: { ...same, status: { not: 'VOID' } }, select: { id: true } });
      if (existing) return { id: existing.id, created: false };

      // The buyer as they are today. Kept on the invoice, so a later change to the client does not alter it.
      const buyer = await tx.organization.findUniqueOrThrow({
        where: { id: input.organizationId },
        select: { name: true, legalName: true, gstin: true, billingAddress: true, stateCode: true },
      });
      const billTo: InvoiceBillTo = {
        name: buyer.name,
        legalName: buyer.legalName,
        gstin: buyer.gstin,
        address: buyer.billingAddress,
        stateCode: buyer.stateCode,
      };

      const lines = input.lines.map((line) => ({ ...line, amountPaise: Math.round(line.quantity * line.unitPricePaise) }));
      const gst = calculateGst(
        lines.map((line) => ({ taxablePaise: line.amountPaise, gstRatePercent: line.gstRatePercent })),
        buyer.stateCode,
      );

      // The next number of the financial year. Void invoices keep theirs, so a number is never used twice.
      const prefix = invoiceNumberPrefix(input.issueDate);
      const last = await tx.invoice.findFirst({
        where: { number: { startsWith: prefix } },
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      const next = (last ? Number(last.number.slice(prefix.length)) || 0 : 0) + 1;

      const created = await tx.invoice.create({
        data: {
          organizationId: input.organizationId,
          outletId: input.outletId,
          ...('bookingId' in subject
            ? { bookingId: subject.bookingId }
            : { subscriptionId: subject.subscriptionId, periodStart: subject.periodStart, periodEnd: subject.periodEnd }),
          number: invoiceNumber(input.issueDate, next),
          issueDate: toDbDate(input.issueDate),
          dueDate: toDbDate(invoiceDueDate(input.issueDate)),
          status: 'ISSUED',
          subtotalPaise: gst.subtotalPaise,
          cgstPaise: gst.cgstPaise,
          sgstPaise: gst.sgstPaise,
          igstPaise: gst.igstPaise,
          totalPaise: gst.totalPaise,
          billTo: billTo as unknown as Prisma.InputJsonValue,
          placeOfSupply: gst.placeOfSupply,
          lines: { create: lines },
        },
        select: { id: true },
      });
      return { id: created.id, created: true };
    });

    // The PDF takes a few seconds, so nothing waits for it; it is made on first open if this fails.
    if (result.created) this.pdfs.makeLater(result.id);
    return result;
  }

  // ───────────────────────── Reading ─────────────────────────

  /** The rows the person may see: everything for ECCS admins, their client's for an Owner, their outlet's for a Manager. */
  private visible(user: AuthUser): Prisma.InvoiceWhereInput | null {
    const scope = accessScope(user.memberships, 'invoices');
    if (!scope || scope.kind === 'assigned') return null;
    // A draft is not an invoice yet. (None is created today; the status exists in the database.)
    const issued: Prisma.InvoiceWhereInput = { status: { not: 'DRAFT' } };
    if (scope.kind === 'all') return issued;
    return {
      ...issued,
      OR: [{ organizationId: { in: scope.organizationIds } }, { outletId: { in: scope.outletIds } }],
    };
  }

  private isAdmin(user: AuthUser): boolean {
    return accessScope(user.memberships, 'invoices')?.kind === 'all';
  }

  /** The newest first. */
  async list(
    user: AuthUser,
    filter: { outletId?: string | undefined; organizationId?: string | undefined; status?: InvoiceStatus | undefined },
  ): Promise<InvoiceSummaryDto[]> {
    const visible = this.visible(user);
    if (!visible) return [];
    const invoices = await this.db.invoice.findMany({
      where: {
        AND: [
          visible,
          filter.outletId ? { outletId: filter.outletId } : {},
          filter.organizationId ? { organizationId: filter.organizationId } : {},
          filter.status ? { status: filter.status } : {},
        ],
      },
      include: invoiceInclude,
      orderBy: [{ issueDate: 'desc' }, { number: 'desc' }],
      take: MAX_LISTED,
    });
    const today = indiaDate();
    return invoices.map((invoice) => toSummary(invoice, today));
  }

  async get(user: AuthUser, invoiceId: string): Promise<InvoiceDto> {
    return this.toDto(user, await this.require(user, invoiceId));
  }

  /**
   * What is owed, across everything the person may see (or one outlet), then
   * by client and by outlet. Only unpaid invoices count; a void one owes nothing.
   */
  async dues(user: AuthUser, filter: { outletId?: string | undefined }): Promise<DuesDto> {
    const visible = this.visible(user);
    const unpaid = visible
      ? await this.db.invoice.findMany({
          where: { AND: [visible, { status: { in: [...UNPAID] } }, filter.outletId ? { outletId: filter.outletId } : {}] },
          select: {
            organizationId: true,
            outletId: true,
            dueDate: true,
            totalPaise: true,
            paidPaise: true,
            organization: { select: { name: true } },
            outlet: { select: { name: true } },
          },
        })
      : [];
    const today = indiaDate();
    const all = emptyDues();
    const clients = new Map<string, ClientDuesDto>();
    const outlets = new Map<string, OutletDuesDto>();
    for (const invoice of unpaid) {
      const owed = { duePaise: invoice.totalPaise - invoice.paidPaise, dueDate: fromDbDate(invoice.dueDate) };
      if (owed.duePaise <= 0) continue;
      addToDues(all, owed, today);
      let client = clients.get(invoice.organizationId);
      if (!client) {
        client = { ...emptyDues(), organizationId: invoice.organizationId, organizationName: invoice.organization.name };
        clients.set(invoice.organizationId, client);
      }
      addToDues(client, owed, today);
      if (invoice.outletId && invoice.outlet) {
        let outlet = outlets.get(invoice.outletId);
        if (!outlet) {
          outlet = { ...emptyDues(), outletId: invoice.outletId, outletName: invoice.outlet.name, organizationId: invoice.organizationId };
          outlets.set(invoice.outletId, outlet);
        }
        addToDues(outlet, owed, today);
      }
    }
    // Whoever has been owing longest comes first.
    const worstFirst = (a: DuesLineDto, b: DuesLineDto) => b.oldestOverdueDays - a.oldestOverdueDays || b.duePaise - a.duePaise;
    return { ...all, clients: [...clients.values()].sort(worstFirst), outlets: [...outlets.values()].sort(worstFirst) };
  }

  /** The totals at the top of the console's Invoices page. ECCS admins only. */
  async totals(user: AuthUser): Promise<BillingTotalsDto> {
    this.requireAdmin(user);
    const dues = await this.dues(user, {});
    // "This month" is the calendar month in India.
    const monthStart = new Date(`${indiaDate().slice(0, 7)}-01T00:00:00+05:30`);
    const collected = await this.db.payment.aggregate({
      where: { status: 'SUCCEEDED', paidAt: { gte: monthStart } },
      _sum: { amountPaise: true },
    });
    return {
      duePaise: dues.duePaise,
      unpaidCount: dues.unpaidCount,
      overduePaise: dues.overduePaise,
      overdueCount: dues.overdueCount,
      collectedThisMonthPaise: collected._sum.amountPaise ?? 0,
    };
  }

  /** A link to the invoice as a PDF. Makes it first if it is missing, or again if the invoice has changed since. */
  async pdf(user: AuthUser, invoiceId: string): Promise<{ path: string }> {
    const invoice = await this.require(user, invoiceId);
    return { path: this.storage.signedPath(await this.pdfs.current(invoice.id)) };
  }

  /** One payment with its invoice as it stands now: what the app shows as the receipt. */
  async receipt(user: AuthUser, paymentId: string): Promise<PaymentResultDto> {
    const payment = await this.db.payment.findUnique({ where: { id: paymentId }, select: { id: true, invoiceId: true } });
    if (!payment) throw new NotFoundException('Payment not found');
    return this.result(user, payment.invoiceId, payment.id);
  }

  // ───────────────────────── ECCS: void, raise again, raise what is due ─────────────────────────

  /** Runs `billDue` now, from the console's "Raise invoices that are due" button. */
  async raiseDue(user: AuthUser): Promise<{ raised: number }> {
    this.requireAdmin(user);
    const { raised } = await this.billDue();
    return { raised };
  }

  /**
   * Cancels an invoice. It is not deleted: it stays on record as void, with
   * the reason, and its number is never used again. Not allowed once any
   * payment has been received on it.
   */
  async void(user: AuthUser, invoiceId: string, reason: string): Promise<InvoiceDto> {
    this.requireAdmin(user);
    await this.require(user, invoiceId);
    await this.db.$transaction(async (tx) => {
      const invoice = await lockInvoice(tx, invoiceId);
      if (invoice.status === 'VOID') throw new ConflictException('This invoice is already void');
      const paid = await tx.payment.count({ where: { invoiceId, status: 'SUCCEEDED' } });
      if (paid > 0 || invoice.paidPaise > 0) {
        throw new ConflictException('A payment has been received on this invoice, so it cannot be made void');
      }
      // A payment someone started in the app and has not finished can no longer go through.
      await tx.payment.updateMany({
        where: { invoiceId, status: 'PENDING' },
        data: { status: 'FAILED', failureReason: 'The invoice was made void before this payment was finished. No money was taken.' },
      });
      await tx.invoice.update({
        where: { id: invoiceId },
        // The PDF on file no longer says what the invoice is: it is made again with the VOID mark.
        data: { status: 'VOID', voidedAt: new Date(), voidReason: reason, pdfKey: null },
      });
    });
    this.pdfs.makeLater(invoiceId);
    return this.get(user, invoiceId);
  }

  /**
   * Raises a new invoice for what a void one was for: the same visit, or the
   * same cycle of the plan (at the plan price the outlet has now). If that has
   * already been done, the invoice that replaced it is returned.
   */
  async raiseAgain(user: AuthUser, invoiceId: string): Promise<InvoiceDto> {
    this.requireAdmin(user);
    const invoice = await this.require(user, invoiceId);
    if (invoice.status !== 'VOID') throw new ConflictException('Only a void invoice can be raised again');

    let raised: string | null = null;
    if (invoice.bookingId) {
      const visitId = invoice.booking?.job?.id;
      raised = visitId ? await this.billVisit(visitId) : null;
    } else if (invoice.subscriptionId && invoice.periodStart && invoice.periodEnd) {
      const again = await this.raiseForSubscription(invoice.subscriptionId, indiaDate(), {
        start: invoice.periodStart,
        end: invoice.periodEnd,
      });
      raised = again?.id ?? null;
    }
    if (!raised) throw new ConflictException('There is nothing to invoice here any more');
    return this.get(user, raised);
  }

  // ───────────────────────── Payments ─────────────────────────

  /**
   * The Owner starts paying an invoice in the app: everything still owed on
   * it, by the method chosen. The payment is on record as pending until the
   * payment screen reports back (`confirmPayment`). Starting again before
   * finishing carries on with the same pending payment.
   */
  async startPayment(user: AuthUser, invoiceId: string, input: { method: string }): Promise<PaymentSessionDto> {
    const invoice = await this.require(user, invoiceId);
    this.requireOwner(user, invoice.organizationId);

    const payment = await this.db.$transaction(async (tx) => {
      const current = await lockInvoice(tx, invoiceId);
      const due = current.totalPaise - current.paidPaise;
      if (current.status === 'VOID') throw new ConflictException('This invoice is void. There is nothing to pay.');
      if (current.status === 'PAID' || due <= 0) throw new ConflictException('This invoice is already paid');

      const waiting = await tx.payment.findFirst({
        where: { invoiceId, status: 'PENDING', gateway: this.gateway.name, recordedById: user.id },
        select: { id: true },
      });
      const data = { amountPaise: due, method: input.method };
      return waiting
        ? tx.payment.update({ where: { id: waiting.id }, data })
        : tx.payment.create({
            data: { ...data, invoiceId, status: 'PENDING', gateway: this.gateway.name, recordedById: user.id },
          });
    });

    const opened = await this.gateway.start({
      paymentId: payment.id,
      invoiceNumber: invoice.number,
      amountPaise: payment.amountPaise,
      method: payment.method,
    });
    if (opened.orderId && opened.orderId !== payment.razorpayOrderId) {
      await this.db.payment.update({ where: { id: payment.id }, data: { razorpayOrderId: opened.orderId } });
    }
    return {
      payment: toPaymentDto(payment, invoice.number, null),
      gateway: this.gateway.name,
      checkout: opened.checkout,
    };
  }

  /**
   * The payment screen reports how a payment ended. A success is added to the
   * invoice; a failure is kept on record with its reason and changes nothing.
   *
   * Sending this twice, or again with a different answer, changes nothing: a
   * payment is decided once, and after that this only returns how it ended.
   */
  async confirmPayment(user: AuthUser, paymentId: string, proof: Record<string, unknown>): Promise<PaymentResultDto> {
    const payment = await this.db.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    const invoice = await this.require(user, payment.invoiceId, 'Payment not found');
    this.requireOwner(user, invoice.organizationId);
    if (payment.status !== 'PENDING') return this.result(user, invoice.id, payment.id);

    const outcome = await this.gateway.confirm(
      {
        paymentId: payment.id,
        invoiceNumber: invoice.number,
        amountPaise: payment.amountPaise,
        method: payment.method,
        orderId: payment.razorpayOrderId,
      },
      proof,
    );

    const changed = await this.db.$transaction(async (tx) => {
      const current = await lockInvoice(tx, invoice.id);
      // Decided meanwhile by the same request sent twice: leave it as it is.
      const fresh = await tx.payment.findUniqueOrThrow({ where: { id: payment.id }, select: { status: true } });
      if (fresh.status !== 'PENDING') return false;

      if (outcome.outcome === 'FAILED') {
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: outcome.reason } });
        return false;
      }
      const due = current.totalPaise - current.paidPaise;
      if (current.status === 'VOID' || payment.amountPaise > due) {
        // Paid or made void from elsewhere while this payment was open. With the sample gateway no money
        // moved; a real gateway would have to send the money back at this point.
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: 'FAILED', failureReason: 'This invoice no longer needs this payment. No money was taken.' },
        });
        return false;
      }
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCEEDED',
          reference: outcome.reference,
          razorpayPaymentId: outcome.providerPaymentId,
          paidAt: new Date(),
        },
      });
      await addToInvoice(tx, current, payment.amountPaise);
      return true;
    });
    if (changed) this.pdfs.makeLater(invoice.id);
    return this.result(user, invoice.id, payment.id);
  }

  /**
   * ECCS records a payment it received outside the app: cash, a bank
   * transfer, a cheque or a UPI reference. Part of what is due may be paid,
   * never more than it. `id`, chosen by the console, makes saving the same
   * form twice record one payment.
   */
  async recordPayment(
    user: AuthUser,
    invoiceId: string,
    input: { id?: string | undefined; method: string; amountPaise: number; paidOn: string; reference?: string | undefined },
  ): Promise<PaymentResultDto> {
    this.requireAdmin(user);
    if (!can(user.memberships, 'payments', 'create')) throw new ForbiddenException('You may not record payments');
    await this.require(user, invoiceId);
    if (input.paidOn > indiaDate()) throw new BadRequestException('The payment date cannot be in the future');

    const paymentId = input.id ?? randomUUID();
    const added = await this.db.$transaction(async (tx) => {
      const current = await lockInvoice(tx, invoiceId);
      const already = await tx.payment.findUnique({ where: { id: paymentId }, select: { invoiceId: true } });
      if (already) {
        if (already.invoiceId !== invoiceId) throw new ConflictException('That payment belongs to another invoice');
        return false;
      }
      if (current.status === 'VOID') throw new ConflictException('This invoice is void. A payment cannot be recorded on it.');
      const due = current.totalPaise - current.paidPaise;
      if (due <= 0) throw new ConflictException('This invoice is already paid');
      if (input.amountPaise > due) {
        throw new BadRequestException(`That is more than what is due on this invoice (${rupees(due)})`);
      }
      await tx.payment.create({
        data: {
          id: paymentId,
          invoiceId,
          amountPaise: input.amountPaise,
          method: input.method,
          status: 'SUCCEEDED',
          gateway: 'manual',
          reference: input.reference || null,
          recordedById: user.id,
          // The day ECCS says the money came in, at noon in India so it reads as that day anywhere.
          paidAt: new Date(`${input.paidOn}T12:00:00+05:30`),
        },
      });
      await addToInvoice(tx, current, input.amountPaise);
      return true;
    });
    if (added) this.pdfs.makeLater(invoiceId);
    return this.result(user, invoiceId, paymentId);
  }

  // ───────────────────────── Helpers ─────────────────────────

  private async result(user: AuthUser, invoiceId: string, paymentId: string): Promise<PaymentResultDto> {
    const invoice = await this.require(user, invoiceId, 'Payment not found');
    const payment = invoice.payments.find((entry) => entry.id === paymentId);
    if (!payment) throw new NotFoundException('Payment not found');
    const dto = await this.toDto(user, invoice);
    return {
      payment: dto.payments.find((entry) => entry.id === paymentId) ?? toPaymentDto(payment, invoice.number, null),
      invoice: dto,
    };
  }

  private requireAdmin(user: AuthUser) {
    if (!this.isAdmin(user)) throw new ForbiddenException('Only ECCS can do this');
  }

  /** Paying is for the client's Owner. A Manager reads the invoices of their outlet but does not pay them. */
  private requireOwner(user: AuthUser, organizationId: string) {
    const owner = user.memberships.some((membership) => membership.role === 'OWNER' && membership.organizationId === organizationId);
    if (!owner || !can(user.memberships, 'payments', 'create', { organizationId })) {
      throw new ForbiddenException('Only the Owner can pay an invoice');
    }
  }

  /** Loads an invoice if the user may see it. "Not found" and "not yours" look the same. */
  private async require(user: AuthUser, invoiceId: string, missing = 'Invoice not found'): Promise<InvoiceRow> {
    const invoice = await this.db.invoice.findUnique({ where: { id: invoiceId }, include: invoiceInclude });
    if (!invoice || invoice.status === 'DRAFT') throw new NotFoundException(missing);
    const allowed =
      accessScope(user.memberships, 'invoices')?.kind !== 'assigned' &&
      can(user.memberships, 'invoices', 'read', { organizationId: invoice.organizationId, outletId: invoice.outletId });
    if (!allowed) throw new NotFoundException(missing);
    return invoice;
  }

  private async toDto(user: AuthUser, invoice: InvoiceRow): Promise<InvoiceDto> {
    const admin = this.isAdmin(user);
    // A restaurant is shown payments that went through or failed; one started and left unfinished is ECCS's to see.
    const payments = invoice.payments.filter((payment) => admin || payment.status !== 'PENDING');
    // Who recorded or started each payment is for ECCS only.
    const recorderIds = admin ? [...new Set(payments.map((payment) => payment.recordedById).filter((id): id is string => !!id))] : [];
    const recorders = recorderIds.length
      ? await this.db.user.findMany({ where: { id: { in: recorderIds } }, select: { id: true, name: true } })
      : [];
    const names = new Map(recorders.map((recorder) => [recorder.id, recorder.name]));

    const billTo = (invoice.billTo ?? { name: invoice.organization.name, legalName: null, gstin: null, address: null, stateCode: null }) as unknown as InvoiceBillTo;
    const gst = calculateGst(
      invoice.lines.map((line) => ({ taxablePaise: line.amountPaise, gstRatePercent: line.gstRatePercent })),
      invoice.placeOfSupply ?? ECCS_STATE_CODE,
    );
    return {
      ...toSummary(invoice, indiaDate()),
      billTo,
      placeOfSupply: gst.placeOfSupply,
      interState: gst.interState,
      subtotalPaise: invoice.subtotalPaise,
      cgstPaise: invoice.cgstPaise,
      sgstPaise: invoice.sgstPaise,
      igstPaise: invoice.igstPaise,
      amountInWords: amountInWords(invoice.totalPaise),
      lines: invoice.lines.map((line, index) => ({
        description: line.description,
        sacCode: line.sacCode,
        quantity: line.quantity,
        unitPricePaise: line.unitPricePaise,
        ...gst.lines[index]!,
      })),
      payments: payments.map((payment) =>
        toPaymentDto(payment, invoice.number, payment.recordedById ? (names.get(payment.recordedById) ?? null) : null),
      ),
      notes: invoice.notes,
      voidedAt: invoice.voidedAt?.toISOString() ?? null,
      voidReason: invoice.voidReason,
      visitId: invoice.booking?.job?.id ?? null,
      pdfReady: invoice.pdfKey !== null,
    };
  }
}

/** The invoice's row, held so that nothing else can change what has been paid on it until this transaction ends. */
async function lockInvoice(tx: Tx, invoiceId: string) {
  await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
  return tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { id: true, status: true, totalPaise: true, paidPaise: true },
  });
}

/** Adds a received payment to its invoice. The PDF on file is then out of date, so it is marked to be made again. */
async function addToInvoice(tx: Tx, invoice: { id: string; totalPaise: number; paidPaise: number }, amountPaise: number) {
  const paidPaise = invoice.paidPaise + amountPaise;
  await tx.invoice.update({
    where: { id: invoice.id },
    data: { paidPaise, status: paidPaise >= invoice.totalPaise ? 'PAID' : 'PARTIALLY_PAID', pdfKey: null },
  });
}

const emptyDues = (): DuesLineDto => ({
  duePaise: 0,
  overduePaise: 0,
  unpaidCount: 0,
  overdueCount: 0,
  oldestOverdueDays: 0,
  oldestDueDate: null,
});

function addToDues(dues: DuesLineDto, invoice: { duePaise: number; dueDate: string }, today: string) {
  const overdueDays = invoiceOverdueDays(invoice.dueDate, today, invoice.duePaise);
  dues.duePaise += invoice.duePaise;
  dues.unpaidCount += 1;
  if (overdueDays > 0) {
    dues.overduePaise += invoice.duePaise;
    dues.overdueCount += 1;
  }
  dues.oldestOverdueDays = Math.max(dues.oldestOverdueDays, overdueDays);
  if (!dues.oldestDueDate || invoice.dueDate < dues.oldestDueDate) dues.oldestDueDate = invoice.dueDate;
}

function toSummary(invoice: InvoiceRow, today: string): InvoiceSummaryDto {
  const status = invoice.status as InvoiceStatus;
  const unpaid = status === 'ISSUED' || status === 'PARTIALLY_PAID';
  const duePaise = unpaid ? Math.max(0, invoice.totalPaise - invoice.paidPaise) : 0;
  const dueDate = fromDbDate(invoice.dueDate);
  return {
    id: invoice.id,
    number: invoice.number,
    kind: invoice.subscriptionId ? 'SUBSCRIPTION' : 'VISIT',
    organizationId: invoice.organizationId,
    organizationName: invoice.organization.name,
    outletId: invoice.outletId,
    outletName: invoice.outlet?.name ?? null,
    description: invoice.lines[0]?.description ?? '',
    issueDate: fromDbDate(invoice.issueDate),
    dueDate,
    periodStart: invoice.periodStart ? fromDbDate(invoice.periodStart) : null,
    periodEnd: invoice.periodEnd ? fromDbDate(invoice.periodEnd) : null,
    status,
    totalPaise: invoice.totalPaise,
    paidPaise: invoice.paidPaise,
    duePaise,
    overdueDays: invoiceOverdueDays(dueDate, today, duePaise),
  };
}

function toPaymentDto(
  payment: {
    id: string;
    invoiceId: string;
    amountPaise: number;
    method: string;
    status: string;
    gateway: string | null;
    reference: string | null;
    failureReason: string | null;
    paidAt: Date | null;
    createdAt: Date;
  },
  number: string,
  recordedByName: string | null,
): PaymentDto {
  return {
    id: payment.id,
    invoiceId: payment.invoiceId,
    invoiceNumber: number,
    amountPaise: payment.amountPaise,
    method: payment.method,
    status: payment.status as PaymentStatus,
    gateway: payment.gateway,
    reference: payment.reference,
    failureReason: payment.failureReason,
    paidAt: payment.paidAt?.toISOString() ?? null,
    createdAt: payment.createdAt.toISOString(),
    recordedByName,
  };
}
