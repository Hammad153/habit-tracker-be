import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { BillingInterval } from '@prisma/client';
import {
  PlanRegistry,
  PlanId,
  PAID_PLANS,
  TRIAL_ENTITLEMENTS,
  BASIC_ENTITLEMENTS,
  PREMIUM_ENTITLEMENTS,
  NO_ENTITLEMENTS,
} from './plans.config';

const makeRegistry = (env: Record<string, string> = {}): PlanRegistry => {
  const configSvc = {
    get: jest.fn((key: string) => env[key]),
  } as unknown as ConfigService;
  return new PlanRegistry(configSvc);
};

describe('PlanRegistry (Phase 3.9 pricing/entitlements)', () => {
  it('exposes exactly the 4 paid plans in NGN (kobo factor applied by clients)', () => {
    expect(PAID_PLANS).toHaveLength(4);
    for (const plan of PAID_PLANS) {
      expect(plan.currency).toBe('NGN');
      expect(plan.amount).toBeGreaterThan(0);
      expect(plan.billingInterval).toMatch(/MONTHLY|YEARLY/);
      expect(plan.paystackPlanCodeEnv).toMatch(/^PAYSTACK_.+_(MONTHLY|ANNUAL)_PLAN_CODE$/);
    }
  });

  it('marks Basic Monthly as most popular and computes annual savings', () => {
    const basicMonthly = PAID_PLANS.find((p) => p.id === PlanId.BASIC_MONTHLY);
    expect(basicMonthly?.mostPopular).toBe(true);
    // ₦3,000 × 12 = ₦36,000 → yearly price ₦30,000 = ₦6,000 saved.
    expect(PAID_PLANS.find((p) => p.id === PlanId.BASIC_YEARLY)?.annualSavings).toBe(6000);
    expect(PAID_PLANS.find((p) => p.id === PlanId.PREMIUM_YEARLY)?.annualSavings).toBe(0);
  });

  it('getTrialDurationDays defaults to 7 and honors TRIAL_DURATION_DAYS', () => {
    expect(makeRegistry().getTrialDurationDays()).toBe(7);
    const reg = makeRegistry({ TRIAL_DURATION_DAYS: '10' });
    expect(reg.getTrialDurationDays()).toBe(10);
  });

  it('getGracePeriodDays defaults to 3 and honors SUBSCRIPTION_GRACE_PERIOD_DAYS', () => {
    expect(makeRegistry().getGracePeriodDays()).toBe(3);
    expect(makeRegistry({ SUBSCRIPTION_GRACE_PERIOD_DAYS: '5' }).getGracePeriodDays()).toBe(5);
  });

  it('resolves Paystack plan codes strictly from env (empty = unconfigured)', () => {
    const reg = makeRegistry({
      PAYSTACK_BASIC_MONTHLY_PLAN_CODE: 'PLN_basic_mo',
      PAYSTACK_PREMIUM_ANNUAL_PLAN_CODE: 'PLN_prem_yr',
    });
    expect(reg.getPaystackPlanCode(PlanId.BASIC_MONTHLY)).toBe('PLN_basic_mo');
    expect(reg.getPaystackPlanCode(PlanId.BASIC_YEARLY)).toBeNull();
    expect(reg.getPaystackPlanCode(PlanId.PREMIUM_YEARLY)).toBe('PLN_prem_yr');
  });

  it('maps a Paystack plan code back to a Routina plan id', () => {
    const reg = makeRegistry({
      PAYSTACK_BASIC_ANNUAL_PLAN_CODE: 'PLN_basic_yr',
    });
    expect(reg.findPlanIdByPaystackCode('PLN_basic_yr')).toBe(PlanId.BASIC_YEARLY);
    expect(reg.findPlanIdByPaystackCode('PLN_unknown')).toBeNull();
    expect(reg.findPlanIdByPaystackCode('')).toBeNull();
  });

  it('requirePaidPlan rejects unknown / trial plan ids', () => {
    const reg = makeRegistry();
    expect(reg.requirePaidPlan(PlanId.PREMIUM_MONTHLY)).toBeTruthy();
    expect(() => reg.requirePaidPlan(PlanId.TRIAL)).toThrow(BadRequestException);
    expect(() => reg.requirePaidPlan('PLAN_404')).toThrow(BadRequestException);
  });

  it('grants full entitlements during the trial', () => {
    const reg = makeRegistry();
    const entitlements = reg.forSubscription('TRIALING', PlanId.TRIAL);
    expect(entitlements).toEqual(TRIAL_ENTITLEMENTS);
    expect(entitlements.aiCoach).toBe(true);
  });

  it('BASIC plans grant everything except aiCoach', () => {
    const reg = makeRegistry();
    for (const id of [PlanId.BASIC_MONTHLY, PlanId.BASIC_YEARLY]) {
      const entitlements = reg.forSubscription('ACTIVE', id);
      expect(entitlements).toEqual(BASIC_ENTITLEMENTS);
      expect(entitlements.aiCoach).toBe(false);
      expect(entitlements.unlimitedHabits).toBe(true);
      expect(entitlements.journal).toBe(true);
    }
  });

  it('PREMIUM plans grant full access including aiCoach', () => {
    const reg = makeRegistry();
    for (const id of [PlanId.PREMIUM_MONTHLY, PlanId.PREMIUM_YEARLY]) {
      expect(reg.forSubscription('ACTIVE', id)).toEqual(PREMIUM_ENTITLEMENTS);
    }
  });

  it('no entitlements for expired / unknown states', () => {
    const reg = makeRegistry();
    expect(reg.forSubscription('EXPIRED', PlanId.BASIC_MONTHLY)).toEqual(NO_ENTITLEMENTS);
    expect(reg.forSubscription('EXPIRED', PlanId.TRIAL)).toEqual(NO_ENTITLEMENTS);
    expect(reg.forSubscription('WEIRD_STATE', 'PLAN_404')).toEqual(NO_ENTITLEMENTS);
  });
});