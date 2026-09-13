import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../core/database/database.service';
import {
  BillingInterval,
  PaymentStatus,
  SubscriptionStatus,
} from '@prisma/client';
import * as crypto from 'crypto';
import { PlanRegistry } from './plans.config';
import { SUBSCRIPTION_CURRENCY } from './plans.config';

const DAY_MS = 86_400_000;

interface PaystackWebhookPayload {
  event: string;
  data: Record<string, any>;
}

/**
 * Secure, idempotent processing of Paystack webhook events. The signature is
 * verified with HMAC-SHA512 over the exact raw body. Every event is recorded
 * in SubscriptionWebhookEvent keyed by (event + payload reference) so Paystack
 * retries are processed exactly once.
 *
 * Access is NEVER granted by a browser callback — only these verified events
 * (and server-side transaction verification) activate a subscription.
 */
@Injectable()
export class SubscriptionWebhookService {
  private readonly logger = new Logger(SubscriptionWebhookService.name);

  constructor(
    private readonly databaseSvc: DatabaseService,
    private readonly configSvc: ConfigService,
    private readonly plans: PlanRegistry,
  ) {}

  /** Verifies x-paystack-signature (HMAC-SHA512, key = secret key, body = raw). */
  verifySignature(
    signature: string | undefined,
    rawBody: Buffer | undefined,
    payload: unknown,
  ): boolean {
    const secret = this.configSvc.get<string>('PAYSTACK_SECRET_KEY')?.trim();
    if (!secret || !signature || !rawBody) return false;
    // Only HMAC over the raw body is trustworthy — JSON.stringify(payload)
    // would re-order keys and break the signature.
    const expected = crypto
      .createHmac('sha512', secret)
      .update(rawBody as any)
      .digest('hex');
    const actual = signature;
    if (actual.length !== expected.length) return false;
    // Constant-time comparison.
    return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  }

  async handleWebhook(
    signature: string | undefined,
    rawBody: Buffer | undefined,
    payload: PaystackWebhookPayload,
  ): Promise<{ event: string; status: 'processed' | 'duplicate' | 'ignored' }> {
    if (!payload?.event || !payload?.data) {
      return { event: payload?.event ?? 'unknown', status: 'ignored' };
    }
    const event = payload.event;
    const dedupeKey = `${event}:${this.dedupeReference(payload.data)}`;

    const existing = await this.databaseSvc.subscriptionWebhookEvent.findUnique(
      {
        where: { dedupeKey },
      },
    );
    if (existing) {
      return { event, status: 'duplicate' };
    }

    const userId = await this.findUserId(payload.data);

    // Idempotency gate first: a retry after a partial failure will hit the
    // unique index and be skipped, never double-applying entitlement changes.
    await this.databaseSvc.subscriptionWebhookEvent.create({
      data: { userId, event, dedupeKey, payload: payload as any },
    });

    try {
      await this.process(event, payload.data, userId);
    } catch (err) {
      this.logger.error(
        `Webhook event ${event} (${dedupeKey}) failed: ${err?.message}`,
        err?.stack,
      );
    }

    return { event, status: 'processed' };
  }

  private async process(
    event: string,
    data: Record<string, any>,
    userId: string | null,
  ) {
    switch (event) {
      case 'charge.success':
        return this.handleChargeSuccess(data, userId);
      case 'subscription.create':
      case 'invoice.update':
        return this.handleSubscriptionUpsert(data, userId);
      case 'invoice.create':
        return this.handleInvoiceCreate(data, userId);
      case 'invoice.payment_failed':
        return this.handlePaymentFailed(data, userId);
      case 'subscription.not_renew':
        return this.handleNotRenew(data, userId);
      case 'subscription.disable':
        return this.handleSubscriptionDisable(data, userId);
      default:
        this.logger.debug(`Webhook event not mapped: ${event}`);
        return;
    }
  }

  /** charge.success: confirm the transaction and activate / extend access. */
  private async handleChargeSuccess(
    data: Record<string, any>,
    userId: string | null,
  ) {
    const reference: string | undefined = data.reference;
    if (!reference) return;

    // Prefer our checkout ledger; fall back to customer-code matching.
    const payment = await this.databaseSvc.paymentTransaction.findUnique({
      where: { reference },
    });
    let resolvedUserId = userId;
    if (payment) {
      resolvedUserId = payment.userId;
    } else {
      const byCustomer = await this.userIdByCustomerCode(
        data.customer?.customer_code,
      );
      resolvedUserId = resolvedUserId ?? byCustomer;
    }
    if (!resolvedUserId) {
      this.logger.warn(
        `charge.success for ${reference}: no Ember user matched; ignored.`,
      );
      return;
    }

    const interval = this.intervalFromData(data) ?? BillingInterval.MONTHLY;
    const amountNaira = this.amountFromData(data);
    const planId = this.planIdFromData(data);

    // If the charge has already been processed for this exact reference, skip.
    const subscriptionRow = await this.databaseSvc.userSubscription.findUnique({
      where: { userId: resolvedUserId },
    });
    if (subscriptionRow?.lastPaymentReference === reference) {
      return;
    }

    await this.activateFromWebhook(resolvedUserId, {
      planId,
      interval,
      amountNaira,
      reference,
      customerCode: data.customer?.customer_code,
      authorizationCode: data.authorization?.authorization_code,
      subscriptionCode:
        data.subscription?.subscription_code ?? data.subscription_code,
      paystackPlanCode: this.planCodeFromData(data),
      nextPaymentDate: data.subscription?.next_payment_date,
    });

    if (payment && payment.status !== PaymentStatus.SUCCESS) {
      await this.databaseSvc.paymentTransaction.update({
        where: { reference },
        data: {
          status: PaymentStatus.SUCCESS,
          paidAt: data.paid_at ? new Date(data.paid_at) : new Date(),
          channel: data.channel ?? payment.channel,
        },
      });
    }
  }

  /** subscription.create / invoice.update: sync recurring subscription metadata. */
  private async handleSubscriptionUpsert(
    data: Record<string, any>,
    userId: string | null,
  ) {
    const resolvedUserId = await this.resolveUserId(data, userId);
    if (!resolvedUserId) return;

    const existing = await this.databaseSvc.userSubscription.findUnique({
      where: { userId: resolvedUserId },
    });
    if (!existing) return;

    const updateData: Record<string, unknown> = {
      paystackSubscriptionCode:
        data.subscription_code ?? existing.paystackSubscriptionCode,
      paystackCustomerCode:
        data.customer?.customer_code ?? existing.paystackCustomerCode,
      cancelAtPeriodEnd:
        data.cancel_at_period_end ?? existing.cancelAtPeriodEnd,
    };

    const planCode = this.planCodeFromData(data);
    if (planCode) {
      updateData.paystackPlanCode = planCode;
      const mapped = this.plans.findPlanIdByPaystackCode(planCode);
      if (mapped) updateData.planId = mapped;
    }
    // invoice.update may carry the next payment date -> period boundary.
    if (data.next_payment_date) {
      const next = new Date(data.next_payment_date);
      if (!isNaN(next.getTime())) updateData.currentPeriodEnd = next;
    }

    await this.databaseSvc.userSubscription.update({
      where: { userId: resolvedUserId },
      data: updateData,
    });
  }

  /** invoice.create: record the upcoming charge reference against the period. */
  private async handleInvoiceCreate(
    data: Record<string, any>,
    userId: string | null,
  ) {
    const resolvedUserId = await this.resolveUserId(data, userId);
    if (!resolvedUserId) return;
    const existing = await this.databaseSvc.userSubscription.findUnique({
      where: { userId: resolvedUserId },
    });
    if (!existing) return;

    const updateData: Record<string, unknown> = {};
    if (data.subscription_code) {
      updateData.paystackSubscriptionCode = data.subscription_code;
    }
    if (data.period_start) {
      const start = new Date(data.period_start);
      if (!isNaN(start.getTime())) updateData.currentPeriodStart = start;
    }
    if (data.period_end) {
      const end = new Date(data.period_end);
      if (!isNaN(end.getTime())) updateData.currentPeriodEnd = end;
    }
    if (Object.keys(updateData).length) {
      await this.databaseSvc.userSubscription.update({
        where: { userId: resolvedUserId },
        data: updateData,
      });
    }
  }

  /**
   * invoice.payment_failed: enter PAYMENT_FAILED + a configurable grace period.
   * Access is retained during the grace period; it lapses automatically when
   * the grace window ends. User data is never deleted.
   */
  private async handlePaymentFailed(
    data: Record<string, any>,
    userId: string | null,
  ) {
    const resolvedUserId = await this.resolveUserId(data, userId);
    if (!resolvedUserId) return;
    const existing = await this.databaseSvc.userSubscription.findUnique({
      where: { userId: resolvedUserId },
    });
    if (!existing || existing.status !== SubscriptionStatus.ACTIVE) return;

    const graceDays = this.plans.getGracePeriodDays();
    const graceEnds = new Date(Date.now() + graceDays * DAY_MS);

    await this.databaseSvc.userSubscription.update({
      where: { userId: resolvedUserId },
      data: {
        status: SubscriptionStatus.PAYMENT_FAILED,
        gracePeriodEndsAt: graceDays > 0 ? graceEnds : new Date(),
      },
    });
  }

  /** subscription.not_renew: user keeps access until the paid period ends. */
  private async handleNotRenew(
    data: Record<string, any>,
    userId: string | null,
  ) {
    const resolvedUserId = await this.resolveUserId(data, userId);
    if (!resolvedUserId) return;
    const existing = await this.databaseSvc.userSubscription.findUnique({
      where: { userId: resolvedUserId },
    });
    if (!existing) return;

    const updateData: Record<string, unknown> = {
      cancelAtPeriodEnd: true,
      cancelledAt: new Date(),
      status: SubscriptionStatus.NON_RENEWING,
    };
    if (data.next_payment_date) {
      const next = new Date(data.next_payment_date);
      if (!isNaN(next.getTime())) updateData.currentPeriodEnd = next;
    }
    await this.databaseSvc.userSubscription.update({
      where: { userId: resolvedUserId },
      data: updateData,
    });
  }

  /** subscription.disable: stop renewal; access continues until period end. */
  private async handleSubscriptionDisable(
    data: Record<string, any>,
    userId: string | null,
  ) {
    const resolvedUserId = await this.resolveUserId(data, userId);
    if (!resolvedUserId) return;
    const existing = await this.databaseSvc.userSubscription.findUnique({
      where: { userId: resolvedUserId },
    });
    if (!existing) return;

    await this.databaseSvc.userSubscription.update({
      where: { userId: resolvedUserId },
      data: {
        cancelAtPeriodEnd: true,
        cancelledAt: new Date(),
        status: SubscriptionStatus.NON_RENEWING,
      },
    });
  }

  private async activateFromWebhook(
    userId: string,
    params: {
      planId: string | null;
      interval: BillingInterval;
      amountNaira: number;
      reference: string;
      customerCode?: string | null;
      authorizationCode?: string | null;
      subscriptionCode?: string | null;
      paystackPlanCode?: string | null;
      nextPaymentDate?: string | null;
    },
  ) {
    let planId = params.planId;
    if (!planId) {
      const mapped = params.paystackPlanCode
        ? this.plans.findPlanIdByPaystackCode(params.paystackPlanCode)
        : null;
      planId =
        mapped ??
        (params.interval === BillingInterval.YEARLY
          ? 'BASIC_YEARLY'
          : 'BASIC_MONTHLY');
    }

    const now = new Date();
    let currentPeriodEnd = this.addInterval(now, params.interval);
    if (params.nextPaymentDate) {
      const next = new Date(params.nextPaymentDate);
      if (!isNaN(next.getTime())) currentPeriodEnd = next;
    }

    await this.databaseSvc.userSubscription.upsert({
      where: { userId },
      update: {
        planId,
        billingInterval: params.interval,
        amountNaira: params.amountNaira,
        currency: SUBSCRIPTION_CURRENCY,
        status: SubscriptionStatus.ACTIVE,
        cancelAtPeriodEnd: false,
        cancelledAt: null,
        currentPeriodStart: now,
        currentPeriodEnd,
        gracePeriodEndsAt: null,
        lastPaymentReference: params.reference,
        paystackCustomerCode: params.customerCode ?? undefined,
        paystackAuthorizationCode: params.authorizationCode ?? undefined,
        paystackSubscriptionCode: params.subscriptionCode ?? undefined,
        paystackPlanCode: params.paystackPlanCode ?? undefined,
      },
      create: {
        userId,
        planId,
        billingInterval: params.interval,
        amountNaira: params.amountNaira,
        currency: SUBSCRIPTION_CURRENCY,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: now,
        currentPeriodEnd,
        lastPaymentReference: params.reference,
        paystackCustomerCode: params.customerCode ?? undefined,
        paystackAuthorizationCode: params.authorizationCode ?? undefined,
        paystackSubscriptionCode: params.subscriptionCode ?? undefined,
        paystackPlanCode: params.paystackPlanCode ?? undefined,
      },
    });
  }

  private async findUserId(data: Record<string, any>): Promise<string | null> {
    const byCustomer = await this.userIdByCustomerCode(
      data.customer?.customer_code,
    );
    if (byCustomer) return byCustomer;
    const email: string | undefined = data.customer?.email;
    if (!email) return null;
    const user = await this.databaseSvc.user.findUnique({ where: { email } });
    return user?.id ?? null;
  }

  /** Prefers the authenticated user; falls back to the Paystack customer code. */
  private async resolveUserId(
    data: Record<string, any>,
    preferredUserId: string | null,
  ): Promise<string | null> {
    if (preferredUserId) return preferredUserId;
    return this.userIdByCustomerCode(data.customer?.customer_code);
  }

  private async userIdByCustomerCode(
    customerCode: string | undefined,
  ): Promise<string | null> {
    if (!customerCode) return null;
    const subscriptionRow = await this.databaseSvc.userSubscription.findFirst({
      where: { paystackCustomerCode: customerCode },
      select: { userId: true },
    });
    return subscriptionRow?.userId ?? null;
  }

  private dedupeReference(data: Record<string, any>): string {
    return (data.reference ||
      data.subscription_code ||
      data.invoice_code ||
      data.id ||
      'unknown') as string;
  }

  private intervalFromData(data: Record<string, any>): BillingInterval | null {
    const raw =
      data.plan?.interval ?? data.subscription?.plan?.interval ?? data.interval;
    if (raw === 'annual' || raw === 'yearly') return BillingInterval.YEARLY;
    if (raw === 'monthly') return BillingInterval.MONTHLY;
    return null;
  }

  /** Charge amounts are in kobo; convert to whole Naira for storage. */
  private amountFromData(data: Record<string, any>): number {
    const kobo = Number(data.amount ?? data.plan?.amount_in_kobo ?? 0);
    return Math.round((kobo || 0) / 100);
  }

  private planCodeFromData(data: Record<string, any>): string | null {
    return data.plan?.plan_code ?? data.subscription?.plan?.plan_code ?? null;
  }

  private planIdFromData(data: Record<string, any>): string | null {
    const code = this.planCodeFromData(data);
    if (code) {
      const mapped = this.plans.findPlanIdByPaystackCode(code);
      if (mapped) return mapped;
    }
    const interval = this.intervalFromData(data);
    // Without a mapped plan code (plans not yet created in Paystack), fall back
    // to the interval tier — recovery is handled by findPlanIdByPaystackCode
    // once plan codes are configured.
    const tier =
      Number(data.plan?.amount_in_kobo) >= 300000 ||
      Number(data.amount) >= 300000
        ? 'PREMIUM'
        : 'BASIC';
    if (!interval) return null;
    return interval === BillingInterval.YEARLY
      ? `${tier}_YEARLY`
      : `${tier}_MONTHLY`;
  }

  private addInterval(from: Date, interval: BillingInterval): Date {
    const end = new Date(from);
    if (interval === BillingInterval.YEARLY) {
      end.setUTCFullYear(end.getUTCFullYear() + 1);
    } else {
      end.setUTCMonth(end.getUTCMonth() + 1);
    }
    return end;
  }
}
