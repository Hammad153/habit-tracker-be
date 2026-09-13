import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BillingInterval,
  PaymentStatus,
  SubscriptionStatus,
} from '@prisma/client';
import { SubscriptionService } from './subscription.service';
import { PlanRegistry, PlanId } from './plans.config';
import { PaystackService } from './paystack.service';

const DAY_MS = 86_400_000;

const makeRow = (overrides: Record<string, any> = {}) => {
  const now = Date.now();
  return {
    userId: 'user-1',
    planId: PlanId.TRIAL,
    status: SubscriptionStatus.TRIALING,
    billingInterval: null,
    amountNaira: null,
    currency: 'NGN',
    trialStartedAt: new Date(now - 2 * DAY_MS),
    trialEndsAt: new Date(now + 5 * DAY_MS),
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    cancelledAt: null,
    gracePeriodEndsAt: null,
    lastPaymentReference: null,
    paystackCustomerCode: null,
    paystackAuthorizationCode: null,
    paystackSubscriptionCode: null,
    paystackPlanCode: null,
    createdAt: new Date(now),
    updatedAt: new Date(now),
    ...overrides,
  };
};

const makeSvc = () => {
  const db = {
    habit: { count: jest.fn().mockResolvedValue(0) },
    userSubscription: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    paymentTransaction: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const configSvc = {
    get: jest.fn((key: string) =>
      key === 'WEB_APP_URL' ? 'https://app.example.com' : undefined,
    ),
  };
  const plans = {
    getPaidPlans: jest.fn().mockReturnValue([]),
    getPaidPlan: jest.fn(),
    requirePaidPlan: jest.fn(),
    getPaystackPlanCode: jest.fn(),
    findPlanIdByPaystackCode: jest.fn(),
    forSubscription: jest.fn((status: string, planId: string) => ({
      unlimitedHabits: true,
      dailyPlan: true,
      journal: status === 'EXPIRED' ? false : true,
      basicAnalytics: true,
      advancedAnalytics: true,
      badgesAndXp: true,
      smartReminders: true,
      dataExport: true,
      customThemes: true,
      aiCoach: planId === 'BASIC_MONTHLY' ? false : true,
      rewards: true,
      identities: true,
    })),
    getTrialDurationDays: jest.fn().mockReturnValue(7),
    getGracePeriodDays: jest.fn().mockReturnValue(3),
  };
  const paystackSvc = {
    isConfigured: jest.fn().mockReturnValue(true),
    initializeTransaction: jest.fn(),
    verifyTransaction: jest.fn(),
    disableSubscription: jest.fn().mockResolvedValue(undefined),
    getSubscription: jest.fn(),
  };
  const svc = new SubscriptionService(
    db as any,
    configSvc as any,
    plans as unknown as PlanRegistry,
    paystackSvc as unknown as PaystackService,
  );
  return { svc, db, configSvc, plans, paystackSvc };
};

describe('SubscriptionService (Phase 3.9)', () => {
  describe('trial lifecycle', () => {
    it('bypasses subscription paywall for ADMIN role users', async () => {
      const { svc, db } = makeSvc();
      db.userSubscription.findUnique.mockResolvedValue(
        makeRow({ status: SubscriptionStatus.EXPIRED, planId: null }),
      );
      db.user.findUnique.mockResolvedValue({ role: 'ADMIN' });

      const info = await svc.getInfo('user-admin');
      expect(info.accessGranted).toBe(true);
      expect(info.status).toBe(SubscriptionStatus.ACTIVE);
      expect(info.tier).toBe('PREMIUM');
    });

    it('startTrialForUser is idempotent — never restarts an existing trial', async () => {
      const { svc, db } = makeSvc();
      db.userSubscription.upsert.mockResolvedValue(makeRow());
      await svc.startTrialForUser('user-1');
      expect(db.userSubscription.upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        update: {},
        create: expect.objectContaining({
          userId: 'user-1',
          planId: PlanId.TRIAL,
          status: SubscriptionStatus.TRIALING,
        }),
      });
    });

    it('grants a trial measured from account creation for legacy users', async () => {
      const { svc, db, plans } = makeSvc();
      plans.getTrialDurationDays.mockReturnValue(7);
      db.userSubscription.findUnique.mockResolvedValue(null);
      db.user.findUnique.mockResolvedValue({
        id: 'user-1',
        createdAt: new Date(Date.now() - 3 * DAY_MS),
      });
      db.userSubscription.create.mockImplementation(({ data }: any) => ({
        ...makeRow(),
        ...data,
      }));

      await svc.getInfo('user-1');
      const call = db.userSubscription.create.mock.calls[0][0];
      // Trial started from account creation (3 days ago) → ends in 4 days.
      expect(call.data.trialStartedAt.getTime()).toBeCloseTo(
        Date.now() - 3 * DAY_MS,
        -2,
      );
      expect(call.data.trialEndsAt.getTime()).toBeCloseTo(
        Date.now() + 4 * DAY_MS,
        -2,
      );
      expect(call.data.status).toBe(SubscriptionStatus.TRIALING);
    });

    it('a single trial is always granted (no free-trial stacking)', async () => {
      const { svc, db, plans } = makeSvc();
      plans.getTrialDurationDays.mockReturnValue(7);
      // Second account for the same email: row already EXISTS with a trial.
      const existing = makeRow({
        planId: PlanId.TRIAL,
        status: SubscriptionStatus.TRIALING,
        trialStartedAt: new Date(Date.now() - DAY_MS),
        trialEndsAt: new Date(Date.now() + 6 * DAY_MS),
      });
      db.userSubscription.findUnique.mockResolvedValue(existing);

      const info = await svc.getInfo('user-2');
      expect(db.userSubscription.create).not.toHaveBeenCalled();
      expect(info.status).toBe('TRIALING');
      expect(info.trialDaysLeft).toBe(6);
    });

    it('lazily persists EXPIRED once the trial window has elapsed', async () => {
      const { svc, db } = makeSvc();
      const expiredTrial = makeRow({
        planId: PlanId.TRIAL,
        status: SubscriptionStatus.TRIALING,
        trialStartedAt: new Date(Date.now() - 10 * DAY_MS),
        trialEndsAt: new Date(Date.now() - DAY_MS),
      });
      db.userSubscription.findUnique.mockResolvedValue(expiredTrial);
      db.userSubscription.update.mockImplementation(({ data }: any) => ({
        ...makeRow(),
        ...expiredTrial,
        ...data,
      }));

      const resolution = await svc.getEffectiveSubscription('user-1');
      expect(db.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          data: { status: SubscriptionStatus.EXPIRED },
        }),
      );
      expect(resolution.status).toBe(SubscriptionStatus.EXPIRED);
      expect(resolution.accessGranted).toBe(false);
    });

    it('does NOT grant access after trial expiry (paywall enforced)', async () => {
      const { svc, db } = makeSvc();
      db.userSubscription.findUnique.mockResolvedValue(
        makeRow({
          status: SubscriptionStatus.EXPIRED,
          trialEndsAt: new Date(Date.now() - DAY_MS),
        }),
      );
      const info = await svc.getInfo('user-1');
      expect(info.accessGranted).toBe(false);
      expect(info.status).toBe(SubscriptionStatus.EXPIRED);
    });

    it('grants Premium access when an admin free-access override is enabled', async () => {
      const { svc, db } = makeSvc();
      db.userSubscription.findUnique.mockResolvedValue(
        makeRow({
          status: SubscriptionStatus.EXPIRED,
          freeAccessEnabled: true,
          freeAccessGrantedBy: 'admin-1',
          freeAccessGrantedAt: new Date(),
          freeAccessExpiresAt: null,
          freeAccessReason: 'Beta tester',
        }),
      );
      db.user.findUnique.mockResolvedValue({ role: 'USER' });

      const info = await svc.getInfo('user-1');
      expect(info.accessGranted).toBe(true);
      expect(info.tier).toBe('PREMIUM');
      expect(info.accessSource).toBe('ADMIN_FREE_ACCESS');
      expect(info.freeAccessReason).toBe('Beta tester');
    });

    it('does not grant access after an admin override expires', async () => {
      const { svc, db } = makeSvc();
      db.userSubscription.findUnique.mockResolvedValue(
        makeRow({
          status: SubscriptionStatus.EXPIRED,
          freeAccessEnabled: true,
          freeAccessExpiresAt: new Date(Date.now() - DAY_MS),
        }),
      );
      db.user.findUnique.mockResolvedValue({ role: 'USER' });

      const info = await svc.getInfo('user-1');
      expect(info.accessGranted).toBe(false);
      expect(info.accessSource).toBe('PAID');
    });
  });

  describe('entitlements', () => {
    it('maps an active BASIC plan with aiCoach false and a Premium without it', async () => {
      const { svc, db } = makeSvc();
      const basic = makeRow({
        planId: PlanId.BASIC_MONTHLY,
        status: SubscriptionStatus.ACTIVE,
        billingInterval: BillingInterval.MONTHLY,
        amountNaira: 3000,
        currency: 'NGN',
      });
      db.userSubscription.findUnique.mockResolvedValue(basic);
      const entitlementsBasic = await svc.getEntitlements('user-1');
      expect(entitlementsBasic.aiCoach).toBe(false);

      db.userSubscription.findUnique.mockResolvedValue({
        ...basic,
        planId: PlanId.PREMIUM_MONTHLY,
      });
      const entitlementsPremium = await svc.getEntitlements('user-1');
      expect(entitlementsPremium.aiCoach).toBe(true);
    });
  });

  describe('checkout + verify (Paystack)', () => {
    it('checkout refuses to run when Paystack is unconfigured', async () => {
      const { svc, plans, paystackSvc } = makeSvc();
      plans.requirePaidPlan.mockReturnValue({
        id: PlanId.BASIC_MONTHLY,
        amount: 3000,
        billingInterval: BillingInterval.MONTHLY,
        currency: 'NGN',
      });
      plans.getPaystackPlanCode.mockReturnValue(null);
      paystackSvc.isConfigured.mockReturnValue(false);
      await expect(
        svc.checkout('user-1', PlanId.BASIC_MONTHLY),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses when no Paystack plan code is mapped in env', async () => {
      const { svc, plans } = makeSvc();
      plans.requirePaidPlan.mockReturnValue({
        id: PlanId.BASIC_MONTHLY,
        amount: 3000,
        billingInterval: BillingInterval.MONTHLY,
        currency: 'NGN',
      });
      plans.getPaystackPlanCode.mockReturnValue(null);
      await expect(
        svc.checkout('user-1', PlanId.BASIC_MONTHLY),
      ).rejects.toThrow(ForbiddenException);
    });

    it('checkout initializes a plan-backed transaction and records it PENDING', async () => {
      const { svc, db, plans, paystackSvc } = makeSvc();
      const now = Date.now();
      plans.requirePaidPlan.mockReturnValue({
        id: PlanId.BASIC_MONTHLY,
        amount: 3000,
        billingInterval: BillingInterval.MONTHLY,
        currency: 'NGN',
      });
      plans.getPaystackPlanCode.mockReturnValue('PLN_basic_monthly');
      paystackSvc.initializeTransaction.mockResolvedValue({
        authorizationUrl: 'https://checkout.paystack.com/abc',
        accessCode: 'ac_abc',
        reference: 'routina_anything',
      });
      db.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
      db.paymentTransaction.create.mockImplementation(({ data }: any) => ({
        id: 'tx-1',
        ...data,
      }));

      const res = await svc.checkout('user-1', PlanId.BASIC_MONTHLY);
      expect(res.reference).toMatch(/^routina_[0-9a-f]{18}$/);
      expect(paystackSvc.initializeTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'a@b.com',
          amountMinor: 3000 * 100, // NGN → kobo
          planCode: 'PLN_basic_monthly',
        }),
      );
      const created = db.paymentTransaction.create.mock.calls[0][0].data;
      expect(created).toMatchObject({
        userId: 'user-1',
        planId: PlanId.BASIC_MONTHLY,
        billingInterval: BillingInterval.MONTHLY,
        amountNaira: 3000,
        currency: 'NGN',
        status: PaymentStatus.PENDING,
      });
      expect(Date.now() - now).toBeGreaterThanOrEqual(0);
    });

    it('verify activates access only after Paystack confirms success, idempotently', async () => {
      const { svc, db, plans, paystackSvc } = makeSvc();
      const payment = {
        userId: 'user-1',
        reference: 'routina_abc',
        planId: PlanId.BASIC_MONTHLY,
        billingInterval: BillingInterval.MONTHLY,
        amountNaira: 3000,
        status: PaymentStatus.PENDING,
      };
      db.paymentTransaction.findUnique.mockResolvedValue(payment);
      paystackSvc.verifyTransaction.mockResolvedValue({
        success: true,
        customerCode: 'CUS_1',
        authorizationCode: 'AUTH_1',
        subscriptionCode: 'SUB_1',
        raw: {},
        plan: {},
      });
      plans.findPlanIdByPaystackCode.mockReturnValue(null);
      plans.getPaidPlan.mockReturnValue({
        id: PlanId.BASIC_MONTHLY,
        amount: 3000,
        billingInterval: BillingInterval.MONTHLY,
        currency: 'NGN',
        paystackPlanCodeEnv: 'PAYSTACK_BASIC_MONTHLY_PLAN_CODE',
      });
      db.userSubscription.upsert.mockResolvedValue(
        makeRow({
          planId: PlanId.BASIC_MONTHLY,
          status: SubscriptionStatus.ACTIVE,
        }),
      );
      // getInfo() re-reads the (now activated) subscription row.
      db.userSubscription.findUnique.mockResolvedValue(
        makeRow({
          planId: PlanId.BASIC_MONTHLY,
          status: SubscriptionStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          amountNaira: 3000,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS),
        }),
      );

      await svc.verify('user-1', 'routina_abc');

      expect(db.userSubscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          update: expect.objectContaining({
            status: SubscriptionStatus.ACTIVE,
            planId: PlanId.BASIC_MONTHLY,
            billingInterval: BillingInterval.MONTHLY,
            cancelAtPeriodEnd: false,
          }),
        }),
      );
      expect(db.paymentTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reference: 'routina_abc' },
          data: expect.objectContaining({ status: PaymentStatus.SUCCESS }),
        }),
      );
    });

    it('verify rejects a reference belonging to another user', async () => {
      const { svc, db } = makeSvc();
      db.paymentTransaction.findUnique.mockResolvedValue({
        userId: 'user-OTHER',
        reference: 'routina_abc',
        planId: PlanId.BASIC_MONTHLY,
        status: PaymentStatus.PENDING,
      });
      await expect(svc.verify('user-1', 'routina_abc')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('verify marks transaction failed when Paystack says so', async () => {
      const { svc, db, paystackSvc } = makeSvc();
      db.paymentTransaction.findUnique.mockResolvedValue({
        userId: 'user-1',
        reference: 'routina_abc',
        planId: PlanId.BASIC_MONTHLY,
        billingInterval: BillingInterval.MONTHLY,
        amountNaira: 3000,
        status: PaymentStatus.PENDING,
      });
      paystackSvc.verifyTransaction.mockResolvedValue({
        success: false,
      } as any);
      await expect(svc.verify('user-1', 'routina_abc')).rejects.toThrow(
        BadRequestException,
      );
      expect(db.paymentTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: PaymentStatus.FAILED }),
        }),
      );
    });
  });

  describe('cancel / resume', () => {
    it('cancel flips ACTIVE → NON_RENEWING + cancelAtPeriodEnd and disables Paystack', async () => {
      const { svc, db, paystackSvc } = makeSvc();
      db.userSubscription.findUnique.mockResolvedValue(
        makeRow({
          planId: PlanId.BASIC_MONTHLY,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: new Date(Date.now() + 20 * DAY_MS),
          paystackSubscriptionCode: 'SUB_1',
        }),
      );
      db.userSubscription.update.mockResolvedValue(makeRow());

      await svc.cancel('user-1');

      expect(db.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          data: expect.objectContaining({
            cancelAtPeriodEnd: true,
            status: SubscriptionStatus.NON_RENEWING,
          }),
        }),
      );
      expect(paystackSvc.disableSubscription).toHaveBeenCalledWith('SUB_1');
    });

    it('cancel rejects when there is nothing active', async () => {
      const { svc, db } = makeSvc();
      db.userSubscription.findUnique.mockResolvedValue(
        makeRow({ status: SubscriptionStatus.TRIALING }),
      );
      await expect(svc.cancel('user-1')).rejects.toThrow(BadRequestException);
    });

    it('resume restores ACTIVE + cancelAtPeriodEnd=false until period end', async () => {
      const { svc, db } = makeSvc();
      db.userSubscription.findUnique.mockResolvedValue(
        makeRow({
          planId: PlanId.BASIC_MONTHLY,
          status: SubscriptionStatus.NON_RENEWING,
          cancelAtPeriodEnd: true,
          currentPeriodEnd: new Date(Date.now() + 10 * DAY_MS),
        }),
      );
      await svc.resume('user-1');
      expect(db.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelAtPeriodEnd: false,
            cancelledAt: null,
            status: SubscriptionStatus.ACTIVE,
          }),
        }),
      );
    });
  });

  describe('effective status transitions', () => {
    it('retains access during a PAYMENT_FAILED grace period', async () => {
      const { svc, db } = makeSvc();
      db.userSubscription.findUnique.mockResolvedValue(
        makeRow({
          planId: PlanId.BASIC_MONTHLY,
          status: SubscriptionStatus.PAYMENT_FAILED,
          currentPeriodEnd: new Date(Date.now() + 10 * DAY_MS),
          gracePeriodEndsAt: new Date(Date.now() + 2 * DAY_MS),
        }),
      );
      const resolution = await svc.getEffectiveSubscription('user-1');
      expect(resolution.status).toBe(SubscriptionStatus.PAYMENT_FAILED);
      expect(resolution.accessGranted).toBe(true);
    });

    it('lapses to EXPIRED when the grace window passes', async () => {
      const { svc, db } = makeSvc();
      db.userSubscription.findUnique.mockResolvedValue(
        makeRow({
          planId: PlanId.BASIC_MONTHLY,
          status: SubscriptionStatus.PAYMENT_FAILED,
          gracePeriodEndsAt: new Date(Date.now() - DAY_MS),
        }),
      );
      db.userSubscription.update.mockImplementation(({ data }: any) => ({
        ...makeRow(),
        ...data,
      }));
      const resolution = await svc.getEffectiveSubscription('user-1');
      expect(resolution.status).toBe(SubscriptionStatus.EXPIRED);
      expect(resolution.accessGranted).toBe(false);
    });

    it('NON_RENEWING keeps access until period end, then expires', async () => {
      const { svc, db } = makeSvc();
      db.userSubscription.findUnique.mockResolvedValue(
        makeRow({
          planId: PlanId.PREMIUM_MONTHLY,
          status: SubscriptionStatus.NON_RENEWING,
          cancelAtPeriodEnd: true,
          currentPeriodEnd: new Date(Date.now() + 5 * DAY_MS),
        }),
      );
      expect(await svc.getEffectiveSubscription('user-1')).toMatchObject({
        status: SubscriptionStatus.NON_RENEWING,
        accessGranted: true,
      });

      db.userSubscription.findUnique.mockResolvedValue(
        makeRow({
          planId: PlanId.PREMIUM_MONTHLY,
          status: SubscriptionStatus.NON_RENEWING,
          currentPeriodEnd: new Date(Date.now() - DAY_MS),
        }),
      );
      db.userSubscription.update.mockImplementation(({ data }: any) => ({
        ...makeRow(),
        ...data,
      }));
      expect(await svc.getEffectiveSubscription('user-1')).toMatchObject({
        status: SubscriptionStatus.EXPIRED,
        accessGranted: false,
      });
    });
  });
});
