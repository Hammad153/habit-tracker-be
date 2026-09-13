import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { BillingInterval } from '@prisma/client';

/**
 * Ember monetization configuration — the single source of truth for plans,
 * prices, entitlements, and Paystack plan-code mapping.
 *
 * Prices are intentionally NOT scattered through the app: the backend exposes
 * them via GET /subscription/plans and the frontend renders them from that
 * response. Paystack plan codes are never hardcoded — they are read from the
 * environment (PAYSTACK_*_PLAN_CODE) so they can evolve without a deploy.
 */

export const SUBSCRIPTION_CURRENCY = 'NGN';
/** Paystack charges NGN amounts in kobo (1 Naira = 100 kobo). */
export const MINOR_UNIT_FACTOR = 100;

export enum PlanId {
  TRIAL = 'TRIAL',
  BASIC_MONTHLY = 'BASIC_MONTHLY',
  BASIC_YEARLY = 'BASIC_YEARLY',
  PREMIUM_MONTHLY = 'PREMIUM_MONTHLY',
  PREMIUM_YEARLY = 'PREMIUM_YEARLY',
}

export type BillingTier = 'TRIAL' | 'BASIC' | 'PREMIUM';

export type FeatureKey =
  | 'unlimitedHabits'
  | 'dailyPlan'
  | 'journal'
  | 'basicAnalytics'
  | 'advancedAnalytics'
  | 'badgesAndXp'
  | 'smartReminders'
  | 'dataExport'
  | 'customThemes'
  | 'aiCoach'
  | 'rewards'
  | 'identities';

export interface FeatureEntitlements {
  unlimitedHabits: boolean;
  dailyPlan: boolean;
  journal: boolean;
  basicAnalytics: boolean;
  advancedAnalytics: boolean;
  badgesAndXp: boolean;
  smartReminders: boolean;
  dataExport: boolean;
  customThemes: boolean;
  aiCoach: boolean;
  rewards: boolean;
  identities: boolean;
}

/** 7-day trial = full Ember experience (unrestricted). */
export const TRIAL_ENTITLEMENTS: FeatureEntitlements = {
  unlimitedHabits: true,
  dailyPlan: true,
  journal: true,
  basicAnalytics: true,
  advancedAnalytics: true,
  badgesAndXp: true,
  smartReminders: true,
  dataExport: true,
  customThemes: true,
  aiCoach: true,
  rewards: true,
  identities: true,
};

/** BASIC — serious routine tracking (everything except AI guidance). */
export const BASIC_ENTITLEMENTS: FeatureEntitlements = {
  ...TRIAL_ENTITLEMENTS,
  aiCoach: false,
};

/** PREMIUM — everything in BASIC plus AI Habit Coach & deeper insights. */
export const PREMIUM_ENTITLEMENTS: FeatureEntitlements = {
  ...TRIAL_ENTITLEMENTS,
};

/** No access (EXPIRED / unknown) — every feature false. */
export const NO_ENTITLEMENTS: FeatureEntitlements = {
  unlimitedHabits: false,
  dailyPlan: false,
  journal: false,
  basicAnalytics: false,
  advancedAnalytics: false,
  badgesAndXp: false,
  smartReminders: false,
  dataExport: false,
  customThemes: false,
  aiCoach: false,
  rewards: false,
  identities: false,
};

export interface PaidPlanConfig {
  id: PlanId;
  tier: Exclude<BillingTier, 'TRIAL'>;
  billingInterval: BillingInterval;
  displayName: string;
  /** Price in whole Naira (₦). */
  amount: number;
  currency: string;
  tagline: string;
  mostPopular?: boolean;
  /** Whole-Naira saving vs paying monthly for a year. */
  annualSavings?: number;
  /** Name of the environment variable holding the Paystack plan code. */
  paystackPlanCodeEnv: string;
}

export const PAID_PLANS: PaidPlanConfig[] = [
  {
    id: PlanId.BASIC_MONTHLY,
    tier: 'BASIC',
    billingInterval: BillingInterval.MONTHLY,
    displayName: 'Basic',
    amount: 3000,
    currency: SUBSCRIPTION_CURRENCY,
    tagline: 'Serious routine tracking',
    mostPopular: true,
    paystackPlanCodeEnv: 'PAYSTACK_BASIC_MONTHLY_PLAN_CODE',
  },
  {
    id: PlanId.BASIC_YEARLY,
    tier: 'BASIC',
    billingInterval: BillingInterval.YEARLY,
    displayName: 'Basic',
    amount: 30000,
    currency: SUBSCRIPTION_CURRENCY,
    tagline: 'Serious routine tracking',
    annualSavings: 6000,
    paystackPlanCodeEnv: 'PAYSTACK_BASIC_ANNUAL_PLAN_CODE',
  },
  {
    id: PlanId.PREMIUM_MONTHLY,
    tier: 'PREMIUM',
    billingInterval: BillingInterval.MONTHLY,
    displayName: 'Premium',
    amount: 5000,
    currency: SUBSCRIPTION_CURRENCY,
    tagline: 'Personalized AI guidance & deeper insights',
    paystackPlanCodeEnv: 'PAYSTACK_PREMIUM_MONTHLY_PLAN_CODE',
  },
  {
    id: PlanId.PREMIUM_YEARLY,
    tier: 'PREMIUM',
    billingInterval: BillingInterval.YEARLY,
    displayName: 'Premium',
    amount: 60000,
    currency: SUBSCRIPTION_CURRENCY,
    tagline: 'Personalized AI guidance & deeper insights',
    annualSavings: 0,
    paystackPlanCodeEnv: 'PAYSTACK_PREMIUM_ANNUAL_PLAN_CODE',
  },
];

export interface EntitlementsResolver {
  forSubscription(status: string, planId: string): FeatureEntitlements;
}

/**
 * Injectable registry so services can resolve plans, plan codes, and
 * entitlements. Reads Paystack plan codes from ConfigService (env-secure).
 */
@Injectable()
export class PlanRegistry implements EntitlementsResolver {
  constructor(private readonly configSvc: ConfigService) {}

  getPaidPlans(): PaidPlanConfig[] {
    return PAID_PLANS;
  }

  getPaidPlan(planId: string): PaidPlanConfig | null {
    return PAID_PLANS.find((p) => p.id === planId) ?? null;
  }

  /** Throws BadRequest for unknown / non-subscribable plan ids. */
  requirePaidPlan(planId: string): PaidPlanConfig {
    const plan = this.getPaidPlan(planId);
    if (!plan) {
      throw new BadRequestException({
        code: 'INVALID_PLAN',
        message: `Unknown subscription plan: ${planId}`,
      });
    }
    return plan;
  }

  /** Resolves the Paystack plan code from the environment for a plan id. */
  getPaystackPlanCode(planId: string): string | null {
    const plan = this.getPaidPlan(planId);
    if (!plan) return null;
    return this.configSvc.get<string>(plan.paystackPlanCodeEnv)?.trim() || null;
  }

  /** Maps a Paystack plan code back to a Ember plan id (if configured). */
  findPlanIdByPaystackCode(paystackPlanCode: string): PlanId | null {
    if (!paystackPlanCode) return null;
    for (const plan of PAID_PLANS) {
      const code = this.configSvc.get<string>(plan.paystackPlanCodeEnv)?.trim();
      if (code && code === paystackPlanCode) return plan.id;
    }
    return null;
  }

  /** Trial duration in days (TRIAL_DURATION_DAYS, default 7). */
  getTrialDurationDays(): number {
    const value = Number(this.configSvc.get<string>('TRIAL_DURATION_DAYS'));
    return Number.isFinite(value) && value > 0 ? value : 7;
  }

  /** Grace period for failed renewal payments (default 3 days). */
  getGracePeriodDays(): number {
    const value = Number(
      this.configSvc.get<string>('SUBSCRIPTION_GRACE_PERIOD_DAYS'),
    );
    return Number.isFinite(value) && value >= 0 ? value : 3;
  }

  /**
   * Entitlements for an effective subscription state. Only granted states
   * (active trial, active/renewing/past-due/failed-grace subscriptions) carry
   * plan features; EXPIRED and unknown states always resolve to none — the
   * stored planId never leaks entitlements to an expired account.
   */
  private grantedStatus(status: string): boolean {
    switch (status) {
      case 'TRIALING':
      case 'ACTIVE':
      case 'NON_RENEWING':
      case 'PAST_DUE':
      case 'PAYMENT_FAILED':
        return true;
      default:
        return false;
    }
  }

  forSubscription(status: string, planId: string): FeatureEntitlements {
    if (!this.grantedStatus(status)) {
      return { ...NO_ENTITLEMENTS };
    }
    if (status === 'TRIALING') {
      return { ...TRIAL_ENTITLEMENTS };
    }
    if (planId === PlanId.PREMIUM_MONTHLY || planId === PlanId.PREMIUM_YEARLY) {
      return { ...PREMIUM_ENTITLEMENTS };
    }
    if (planId === PlanId.BASIC_MONTHLY || planId === PlanId.BASIC_YEARLY) {
      return { ...BASIC_ENTITLEMENTS };
    }
    // A granted status but an unknown stored plan: deny premium extras.
    return { ...BASIC_ENTITLEMENTS };
  }
}
