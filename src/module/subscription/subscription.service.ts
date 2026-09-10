import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../core/database/database.service';
import {
  BillingInterval,
  PaymentStatus,
  SubscriptionStatus,
  UserSubscription,
} from '@prisma/client';
import * as crypto from 'crypto';
import {
  PaidPlanConfig,
  PlanId,
  PlanRegistry,
  FeatureEntitlements,
  SUBSCRIPTION_CURRENCY,
} from './plans.config';
import { PaystackService } from './paystack.service';

export type BillingTier = 'TRIAL' | 'BASIC' | 'PREMIUM';

export interface SubscriptionInfo {
  currentPlan: string;
  tier: BillingTier;
  status: string;
  accessGranted: boolean;
  habitLimit: number; // -1 = unlimited
  currentHabitCount: number;
  canCreateHabit: boolean;
  currency: string;
  amount: number | null;
  billingInterval: BillingInterval | null;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
  gracePeriodEndsAt: string | null;
  paymentMethodNeedsUpdate: boolean;
  nextBillingDate: string | null;
  entitlements: FeatureEntitlements;
}

export interface SubscriptionResolution {
  row: UserSubscription;
  status: string;
  accessGranted: boolean;
  entitlements: FeatureEntitlements;
  tier: BillingTier;
  plan: PaidPlanConfig | null;
}

const DAY_MS = 86_400_000;

/**
 * Server-authoritative subscription engine.
 *
 * Rules:
 *  - Every new account gets a single 7-day trial (started at signup). It is
 *    tied to the authenticated account and cannot be restarted by logging out,
 *    switching devices, refreshing, or clearing local storage.
 *  - Paystack webhooks + server-side verification are the only paths that turn
 *    a payment into ACTIVE access.
 *  - Cancellation never revokes access instantly; it stops future renewals and
 *    access continues until the paid period ends.
 *  - Failed renewals enter a configurable grace period before access lapses.
 *  - Expiring a trial or subscription NEVER deletes user data.
 */
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly databaseSvc: DatabaseService,
    private readonly configSvc: ConfigService,
    private readonly plans: PlanRegistry,
    private readonly paystackSvc: PaystackService,
  ) {}

  // ------------------------------------------------------------------
  // Public reads
  // ------------------------------------------------------------------

  async getPlans(): Promise<{
    currency: string;
    trialDurationDays: number;
    plans: Array<{
      id: string;
      tier: BillingTier;
      displayName: string;
      billingInterval: BillingInterval;
      amount: number;
      currency: string;
      tagline: string;
      mostPopular: boolean;
      annualSavings: number | null;
    }>;
  }> {
    return {
      currency: SUBSCRIPTION_CURRENCY,
      trialDurationDays: this.plans.getTrialDurationDays(),
      plans: this.plans.getPaidPlans().map((plan) => ({
        id: plan.id,
        tier: plan.tier,
        displayName: plan.displayName,
        billingInterval: plan.billingInterval,
        amount: plan.amount,
        currency: plan.currency,
        tagline: plan.tagline,
        mostPopular: Boolean(plan.mostPopular),
        annualSavings: plan.annualSavings ?? null,
      })),
    };
  }

  async getInfo(userId: string): Promise<SubscriptionInfo> {
    const resolution = await this.getEffectiveSubscription(userId);
    const row = resolution.row;
    const now = Date.now();

    const trialDaysLeft =
      row.status === SubscriptionStatus.TRIALING && row.trialEndsAt
        ? Math.max(0, Math.ceil((row.trialEndsAt.getTime() - now) / DAY_MS))
        : null;

    let currentHabitCount = 0;
    if (userId) {
      currentHabitCount = await this.databaseSvc.habit.count({
        where: { userId, isArchived: false },
      });
    }

    return {
      currentPlan: row.planId,
      tier: resolution.tier,
      status: resolution.status,
      accessGranted: resolution.accessGranted,
      habitLimit: -1,
      currentHabitCount,
      canCreateHabit: true,
      currency: row.currency || SUBSCRIPTION_CURRENCY,
      amount: row.amountNaira,
      billingInterval: row.billingInterval ?? null,
      trialStartedAt: row.trialStartedAt?.toISOString() ?? null,
      trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
      trialDaysLeft,
      currentPeriodStart: row.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      gracePeriodEndsAt: row.gracePeriodEndsAt?.toISOString() ?? null,
      paymentMethodNeedsUpdate:
        resolution.status === SubscriptionStatus.PAYMENT_FAILED ||
        resolution.status === SubscriptionStatus.PAST_DUE,
      nextBillingDate: row.currentPeriodEnd?.toISOString() ?? null,
      entitlements: resolution.entitlements,
    };
  }

  /**
   * Returns the effective subscription state for the user, lazily transitioning
   * expired trials / lapsed periods to EXPIRED (persisted). Used by the
   * SubscriptionAccessGuard as the authoritative access decision.
   */
  async getEffectiveSubscription(userId: string): Promise<SubscriptionResolution> {
    const row = await this.resolveRow(userId);
    const { status, needsPersist } = this.computeEffectiveStatus(row);
    const effectiveRow = needsPersist
      ? await this.databaseSvc.userSubscription.update({
          where: { userId },
          data: { status: status as SubscriptionStatus },
        })
      : row;

    const user = await this.databaseSvc.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    const isAdmin = user?.role === 'ADMIN';

    // NO_ENTITLEMENTS for expired access is handled inside forSubscription
    // via the fallback branch; TRIALING/ACTIVE/etc. resolve normally.
    const entitlements = this.plans.forSubscription(
      isAdmin ? SubscriptionStatus.ACTIVE : effectiveRow.status,
      isAdmin ? 'PREMIUM_YEARLY' : effectiveRow.planId,
    );

    return {
      row: effectiveRow,
      status: isAdmin ? SubscriptionStatus.ACTIVE : effectiveRow.status,
      accessGranted: isAdmin ? true : this.isGrantedStatus(effectiveRow.status),
      entitlements,
      tier: isAdmin ? 'PREMIUM' : this.tierFor(effectiveRow),
      plan: isAdmin
        ? this.plans.getPaidPlan('PREMIUM_YEARLY')
        : effectiveRow.planId
        ? this.plans.getPaidPlan(effectiveRow.planId)
        : null,
    };
  }

  async getEntitlements(userId: string): Promise<FeatureEntitlements> {
    return (await this.getEffectiveSubscription(userId)).entitlements;
  }

  // ------------------------------------------------------------------
  // Trial lifecycle
  // ------------------------------------------------------------------

  /**
   * Starts the (single) 7-day trial for a fresh account. Idempotent: if a
   * subscription row already exists (e.g. after a repeated signup attempt on
   * the same email) it is left untouched — trials can never be restarted.
   */
  async startTrialForUser(
    userId: string,
    trialStartedAt: Date = new Date(),
  ): Promise<void> {
    const durationDays = this.plans.getTrialDurationDays();
    const trialEndsAt = new Date(trialStartedAt.getTime() + durationDays * DAY_MS);
    await this.databaseSvc.userSubscription.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        planId: PlanId.TRIAL,
        status: SubscriptionStatus.TRIALING,
        trialStartedAt,
        trialEndsAt,
      },
    });
  }

  // ------------------------------------------------------------------
  // Paystack checkout
  // ------------------------------------------------------------------

  async checkout(
    userId: string,
    planId: string,
  ): Promise<{
    planId: string;
    reference: string;
    authorizationUrl: string;
  }> {
    const plan = this.plans.requirePaidPlan(planId);
    const paystackPlanCode = this.plans.getPaystackPlanCode(planId);

    if (!this.paystackSvc.isConfigured() || !paystackPlanCode) {
      throw new ForbiddenException({
        code: 'PAYMENTS_NOT_CONFIGURED',
        message:
          'Payments are not configured yet. Please set PAYSTACK_SECRET_KEY and the Paystack plan codes in the environment.',
      });
    }

    const user = await this.databaseSvc.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const reference = `routina_${crypto.randomBytes(9).toString('hex')}`;
    const callbackUrl =
      (this.configSvc.get<string>('WEB_APP_URL') || '').trim() +
      '/subscription/result?reference=' +
      reference;

    const init = await this.paystackSvc.initializeTransaction({
      email: user.email,
      amountMinor: plan.amount * 100,
      planCode: paystackPlanCode,
      reference,
      callbackUrl: callbackUrl || undefined,
      metadata: { userId, planId, app: 'routina' },
    });

    await this.databaseSvc.paymentTransaction.create({
      data: {
        userId,
        reference,
        planId,
        billingInterval: plan.billingInterval,
        amountNaira: plan.amount,
        currency: plan.currency,
        status: PaymentStatus.PENDING,
        metadata: { authorizationUrl: init.authorizationUrl },
      },
    });

    return {
      planId,
      reference,
      authorizationUrl: init.authorizationUrl,
    };
  }

  /**
   * Server-side payment verification. The browser's `success=true` is never
   * trusted — access is granted only after Paystack confirms the transaction.
   * Idempotent and safe to call multiple times (also runs after the webhook).
   */
  async verify(userId: string, reference: string): Promise<SubscriptionInfo> {
    if (!reference) {
      throw new BadRequestException({ code: 'INVALID_REFERENCE', message: 'Missing payment reference' });
    }
    const payment = await this.databaseSvc.paymentTransaction.findUnique({
      where: { reference },
    });
    if (!payment || payment.userId !== userId) {
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: 'No matching payment for this reference.',
      });
    }
    if (payment.status === PaymentStatus.SUCCESS) {
      // Already activated (typically by the webhook) — report current state.
      return this.getInfo(userId);
    }

    const verified = await this.paystackSvc.verifyTransaction(reference);
    if (!verified.success) {
      await this.databaseSvc.paymentTransaction.update({
        where: { reference },
        data: { status: PaymentStatus.FAILED },
      });
      throw new BadRequestException({
        code: 'PAYMENT_VERIFICATION_FAILED',
        message: 'The payment was not successful.',
      });
    }

    await this.activateSubscription(userId, {
      planId: payment.planId,
      billingInterval: payment.billingInterval as BillingInterval,
      amountNaira: payment.amountNaira,
      reference,
      customerCode: verified.customerCode,
      authorizationCode: verified.authorizationCode,
      subscriptionCode: verified.subscriptionCode,
      paystackPlanCode: this.planCodeFromVerified(verified.raw),
    });

    await this.databaseSvc.paymentTransaction.update({
      where: { reference },
      data: {
        status: PaymentStatus.SUCCESS,
        paidAt: verified.paidAt ? new Date(verified.paidAt) : new Date(),
        channel: verified.channel || null,
      },
    });

    return this.getInfo(userId);
  }

  // ------------------------------------------------------------------
  // Subscription management
  // ------------------------------------------------------------------

  /**
   * Cancel future renewal. Access continues until the current period ends
   * (NON_RENEWING), then lapses. Paystack-side disable is attempted so no
   * further charges occur; failures are logged and webhooks keep state honest.
   */
  async cancel(userId: string): Promise<SubscriptionInfo> {
    const resolution = await this.getEffectiveSubscription(userId);
    if (resolution.status !== SubscriptionStatus.ACTIVE) {
      throw new BadRequestException({
        code: 'NOT_ACTIVE',
        message: 'Only an active subscription can be cancelled.',
      });
    }
    await this.databaseSvc.userSubscription.update({
      where: { userId },
      data: {
        cancelAtPeriodEnd: true,
        cancelledAt: new Date(),
        status: SubscriptionStatus.NON_RENEWING,
      },
    });
    const code = resolution.row.paystackSubscriptionCode;
    if (code) {
      this.paystackSvc
        .disableSubscription(code)
        .catch((err) =>
          this.logger.warn(
            `Paystack disable failed for ${code}: ${err?.message}`,
          ),
        );
    }
    return this.getInfo(userId);
  }

  /**
   * Resume renewal before the paid period ends. Paystack's `disable` is
   * irreversible, so if the Paystack subscription was already disabled a new
   * checkout is required at the next cycle — the local flag is still reset so
   * the user keeps access for the remainder of the current period.
   */
  async resume(userId: string): Promise<SubscriptionInfo> {
    const resolution = await this.getEffectiveSubscription(userId);
    if (
      resolution.status !== SubscriptionStatus.NON_RENEWING &&
      resolution.status !== SubscriptionStatus.ACTIVE
    ) {
      throw new BadRequestException({
        code: 'NOT_ACTIVE',
        message: 'There is no renewable subscription to resume.',
      });
    }
    if (resolution.row.cancelAtPeriodEnd) {
      await this.databaseSvc.userSubscription.update({
        where: { userId },
        data: {
          cancelAtPeriodEnd: false,
          cancelledAt: null,
          status: SubscriptionStatus.ACTIVE,
        },
      });
    }
    return this.getInfo(userId);
  }

  async listTransactions(userId: string) {
    return this.databaseSvc.paymentTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  // ------------------------------------------------------------------
  // Shared activation / state helpers (used by verify + webhook)
  // ------------------------------------------------------------------

  async activateSubscription(
    userId: string,
    params: {
      planId: string;
      billingInterval: BillingInterval;
      amountNaira: number;
      reference: string;
      customerCode?: string | null;
      authorizationCode?: string | null;
      subscriptionCode?: string | null;
      paystackPlanCode?: string | null;
      paystackStatus?: string;
    },
  ): Promise<void> {
    const plan = this.plans.getPaidPlan(params.planId);
    if (!plan) {
      this.logger.warn(`activateSubscription: unknown plan ${params.planId}`);
      throw new BadRequestException({ code: 'INVALID_PLAN', message: 'Unknown plan' });
    }

    const now = new Date();
    // Resolve the stored plan if the verified paystack plan code differs
    // (e.g. plan codes changed). Trust the webhook/verified plan code first.
    let planId = params.planId;
    if (params.paystackPlanCode) {
      const mapped = this.plans.findPlanIdByPaystackCode(params.paystackPlanCode);
      if (mapped) planId = mapped;
    }

    const currentPeriodEnd = this.addInterval(now, params.billingInterval);

    await this.databaseSvc.userSubscription.upsert({
      where: { userId },
      update: {
        planId,
        billingInterval: params.billingInterval,
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
        paystackPlanCode: params.paystackPlanCode ?? plan.paystackPlanCodeEnv,
      },
      create: {
        userId,
        planId,
        billingInterval: params.billingInterval,
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

  // The trial timestamps are left untouched by activation — the `update` data
  // omits them so Prisma leaves trialStartedAt/trialEndsAt as-is.

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private async resolveRow(userId: string): Promise<UserSubscription> {
    let row = await this.databaseSvc.userSubscription.findUnique({
      where: { userId },
    });
    if (row) return row;

    // Accounts created before subscriptions existed: grant the 7-day trial
    // measured from account creation. No user data is ever modified.
    const user = await this.databaseSvc.user.findUnique({
      where: { id: userId },
      select: { createdAt: true },
    });
    const start = user?.createdAt ?? new Date();
    const durationDays = this.plans.getTrialDurationDays();
    row = await this.databaseSvc.userSubscription.create({
      data: {
        userId,
        planId: PlanId.TRIAL,
        status: SubscriptionStatus.TRIALING,
        trialStartedAt: start,
        trialEndsAt: new Date(start.getTime() + durationDays * DAY_MS),
      },
    });
    return row;
  }

  private computeEffectiveStatus(row: UserSubscription): {
    status: string;
    needsPersist: boolean;
  } {
    const now = Date.now();
    switch (row.status) {
      case SubscriptionStatus.TRIALING:
        if (row.trialEndsAt && now >= row.trialEndsAt.getTime()) {
          return { status: SubscriptionStatus.EXPIRED, needsPersist: true };
        }
        return { status: SubscriptionStatus.TRIALING, needsPersist: false };
      case SubscriptionStatus.ACTIVE:
      case SubscriptionStatus.NON_RENEWING:
      case SubscriptionStatus.CANCELLED:
        if (row.currentPeriodEnd && now >= row.currentPeriodEnd.getTime()) {
          return { status: SubscriptionStatus.EXPIRED, needsPersist: true };
        }
        if (row.status === SubscriptionStatus.CANCELLED) {
          return { status: SubscriptionStatus.NON_RENEWING, needsPersist: true };
        }
        return { status: row.status, needsPersist: false };
      case SubscriptionStatus.PAST_DUE:
      case SubscriptionStatus.PAYMENT_FAILED:
        if (row.gracePeriodEndsAt && now >= row.gracePeriodEndsAt.getTime()) {
          return { status: SubscriptionStatus.EXPIRED, needsPersist: true };
        }
        if (!row.gracePeriodEndsAt) {
          return { status: SubscriptionStatus.EXPIRED, needsPersist: true };
        }
        return { status: row.status, needsPersist: false };
      default:
        return { status: SubscriptionStatus.EXPIRED, needsPersist: false };
    }
  }

  private isGrantedStatus(status: string): boolean {
    switch (status) {
      case SubscriptionStatus.TRIALING:
      case SubscriptionStatus.ACTIVE:
      case SubscriptionStatus.NON_RENEWING:
      case SubscriptionStatus.PAST_DUE:
      case SubscriptionStatus.PAYMENT_FAILED:
        return true;
      default:
        return false;
    }
  }

  private tierFor(row: UserSubscription): BillingTier {
    if (row.status === SubscriptionStatus.TRIALING) return 'TRIAL';
    if (
      row.planId === PlanId.BASIC_MONTHLY ||
      row.planId === PlanId.BASIC_YEARLY
    ) {
      return 'BASIC';
    }
    if (
      row.planId === PlanId.PREMIUM_MONTHLY ||
      row.planId === PlanId.PREMIUM_YEARLY
    ) {
      return 'PREMIUM';
    }
    return 'TRIAL';
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

  private planCodeFromVerified(raw: Record<string, unknown>): string | null {
    const plan = (raw as any)?.plan;
    return plan?.plan_code ?? null;
  }
}