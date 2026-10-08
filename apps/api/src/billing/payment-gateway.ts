import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';

// How the app takes an online payment, kept behind one small interface so the
// provider can be changed without touching invoices, the console or the app's
// Invoices screen.
//
// Today there is one implementation, the sample gateway below: no network, no
// provider and no real money. To use Razorpay (test mode first) later, write a
// second class with the same two methods and name it in billing.module.ts:
// `start` would create a Razorpay order and return its id and the public key
// for Razorpay's checkout, and `confirm` would check the signature the checkout
// sends back. Nothing else in the server needs to change; the app needs a
// screen for that gateway's checkout in place of the sample one.

/** What a gateway is told about a payment being started. */
export interface GatewayStart {
  paymentId: string;
  invoiceNumber: string;
  amountPaise: number;
  /** "upi", "card" or "netbanking", as chosen in the app. */
  method: string;
}

/** How a payment ended, as the gateway reports it. */
export type GatewayOutcome =
  | { outcome: 'SUCCEEDED'; reference: string; providerPaymentId: string | null }
  | { outcome: 'FAILED'; reason: string };

export interface PaymentGateway {
  /** Stored on each payment ("sample"), and tells the app which payment screen to show. */
  readonly name: string;
  /**
   * Opens the payment with the provider. `orderId` is the provider's own
   * reference for it, if it has one; `checkout` is whatever the app's payment
   * screen for this gateway needs.
   */
  start(payment: GatewayStart): Promise<{ orderId: string | null; checkout: Record<string, unknown> }>;
  /**
   * Decides how the payment ended from what the app sent back (`proof`). A
   * real gateway must not trust the app here: it checks the provider's
   * signature or asks the provider.
   */
  confirm(payment: GatewayStart & { orderId: string | null }, proof: Record<string, unknown>): Promise<GatewayOutcome>;
}

/** The name the gateway in use is registered under in billing.module.ts. */
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

/**
 * The sample gateway. No money moves and nothing leaves this server: the
 * app's sample payment screen says so, and sends back "success" or, when the
 * person chose "Make this payment fail", "fail", so both endings can be tried.
 */
@Injectable()
export class SamplePaymentGateway implements PaymentGateway {
  readonly name = 'sample';

  start(): Promise<{ orderId: string | null; checkout: Record<string, unknown> }> {
    return Promise.resolve({ orderId: null, checkout: {} });
  }

  confirm(_payment: GatewayStart & { orderId: string | null }, proof: Record<string, unknown>): Promise<GatewayOutcome> {
    if (proof.outcome === 'fail') {
      return Promise.resolve({ outcome: 'FAILED', reason: 'The sample payment was made to fail. No money was taken.' });
    }
    // A made-up reference in the style of a bank's, clearly marked as a sample.
    return Promise.resolve({
      outcome: 'SUCCEEDED',
      reference: `SAMPLE-${randomBytes(5).toString('hex').toUpperCase()}`,
      providerPaymentId: null,
    });
  }
}
