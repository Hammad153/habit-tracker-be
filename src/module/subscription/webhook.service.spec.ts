import { ConfigService } from '@nestjs/config';
import {
  BillingInterval,
  PaymentStatus,
  SubscriptionStatus,
} from '@prisma/client';
import * as crypto from 'crypto';
import { SubscriptionWebhookService } from './webhook.service';
import { PlanRegistry } from './plans.config';

const SECRET = 'sk_test_webhooksecret';

const sign = (raw: string, secret = SECRET) =>
  crypto.createHmac('sha512', secret).update(raw).digest('hex');

const chargeSuccessPayload = (reference = 'routina_0001') => ({
  event: 'charge.success',
  data: {
    reference,
    amount: 300000, // ₦3,000 in kobo
    status: 'success',
    paid_at: '2026-09-10T12:00:00.000Z',
    channel: 'card',
    customer: { email: 'a@b.com', customer_code: 'CUS_1' },
    authorization: { authorization_code: 'AUTH_1' },
    subscription: {
      subscription_code: 'SUB_1',
      next_payment_date: '2026-10-10T12:00:00.000Z',
    },
    plan: { plan_code: 'PLN_basic_monthly', interval: 'monthly' },
  },
});

const makeSvc = () => {
  const db = {
    subscriptionWebhookEvent: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    userSubscription: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    paymentTransaction: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  };
  const configSvc = {
    get: jest.fn((key: string) => {
      if (key === 'PAYSTACK_SECRET_KEY') return SECRET;
      return undefined;
    }),
  };
  const plans = {
    getGracePeriodDays: jest.fn().mockReturnValue(3),
    getTrialDurationDays: jest.fn().mockReturnValue(7),
    findPlanIdByPaystackCode: jest.fn().mockReturnValue(null),
    getPaidPlan: jest.fn(),
    getPaystackPlanCode: jest.fn(),
    forSubscription: jest.fn(),
  };
  const svc = new SubscriptionWebhookService(
    db as any,
    configSvc as any,
    plans as unknown as PlanRegistry,
  );
  return { svc, db, configSvc, plans };
};

const row = (overrides: Record<string, any> = {}) => ({
  userId: 'user-1',
  planId: 'BASIC_MONTHLY',
  status: SubscriptionStatus.ACTIVE,
  billingInterval: BillingInterval.MONTHLY,
  amountNaira: 3000,
  currency: 'NGN',
  trialStartedAt: null,
  trialEndsAt: null,
  currentPeriodStart: new Date(),
  currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000),
  cancelAtPeriodEnd: false,
  cancelledAt: null,
  gracePeriodEndsAt: null,
  lastPaymentReference: 'routina_0001',
  paystackCustomerCode: 'CUS_1',
  paystackSubscriptionCode: 'SUB_1',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('SubscriptionWebhookService (Phase 3.9)', () => {
  describe('signature verification (HMAC-SHA512 over raw body)', () => {
    it('accepts a valid signature for the exact raw body', () => {
      const { svc } = makeSvc();
      const raw = Buffer.from(JSON.stringify(chargeSuccessPayload()));
      expect(svc.verifySignature(sign(raw.toString()), raw, { event: 'x' })).toBe(true);
    });

    it('rejects a signature computed for a different body (key-reorder attack)', () => {
      const { svc } = makeSvc();
      const raw = Buffer.from(JSON.stringify(chargeSuccessPayload()));
      const other = sign('{"event":"charge.success"}' + '"data":{}');
      expect(svc.verifySignature(other, raw, {})).toBe(false);
    });

    it('rejects missing / wrong secret / missing raw body', () => {
      const { svc } = makeSvc();
      const raw = Buffer.from(JSON.stringify(chargeSuccessPayload()));
      expect(svc.verifySignature(undefined, raw, {})).toBe(false);
      expect(svc.verifySignature('bad-signature', raw, {})).toBe(false);
      expect(svc.verifySignature('bad', undefined, {})).toBe(false);
    });
  });

  describe('idempotent event processing', () => {
    it('charge.success activates the subscription and marks the payment SUCCESS', async () => {
      const { svc, db } = makeSvc();
      const payload = chargeSuccessPayload();
      db.subscriptionWebhookEvent.findUnique.mockResolvedValue(null);
      db.subscriptionWebhookEvent.create.mockResolvedValue({});
      db.user.findUnique.mockResolvedValue({ id: 'user-1' });
      db.paymentTransaction.findUnique.mockResolvedValue({
        userId: 'user-1',
        reference: 'routina_0001',
        planId: 'BASIC_MONTHLY',
        billingInterval: BillingInterval.MONTHLY,
        amountNaira: 3000,
        status: PaymentStatus.PENDING,
        channel: null,
      });
      db.userSubscription.findUnique.mockResolvedValue(null);

      const out = await svc.handleWebhook(
        sign(JSON.stringify(payload)),
        Buffer.from(JSON.stringify(payload)),
        payload,
      );

      expect(out.status).toBe('processed');
      expect(db.subscriptionWebhookEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event: 'charge.success',
            userId: 'user-1',
            dedupeKey: 'charge.success:routina_0001',
          }),
        }),
      );
      expect(db.userSubscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          update: expect.objectContaining({
            status: SubscriptionStatus.ACTIVE,
            planId: 'BASIC_MONTHLY',
            currency: 'NGN',
            lastPaymentReference: 'routina_0001',
          }),
          create: expect.objectContaining({
            userId: 'user-1',
            status: SubscriptionStatus.ACTIVE,
          }),
        }),
      );
      expect(db.paymentTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reference: 'routina_0001' },
          data: expect.objectContaining({ status: PaymentStatus.SUCCESS }),
        }),
      );
    });

    it('skips reprocessing a retried event (returns duplicate)', async () => {
      const { svc, db } = makeSvc();
      const payload = chargeSuccessPayload('routina_dup');
      db.subscriptionWebhookEvent.findUnique.mockResolvedValue({
        id: 'ledger-1',
        dedupeKey: 'charge.success:routina_dup',
      });

      const out = await svc.handleWebhook(
        sign(JSON.stringify(payload)),
        Buffer.from(JSON.stringify(payload)),
        payload,
      );
      expect(out.status).toBe('duplicate');
      expect(db.subscriptionWebhookEvent.create).not.toHaveBeenCalled();
      expect(db.userSubscription.upsert).not.toHaveBeenCalled();
    });

    it('matches a user by Paystack customer code even without the email', async () => {
      const { svc, db } = makeSvc();
      const payload = chargeSuccessPayload('routina_cus');
      payload.data.customer = { customer_code: 'CUS_1' } as any;
      db.subscriptionWebhookEvent.findUnique.mockResolvedValue(null);
      db.subscriptionWebhookEvent.create.mockResolvedValue({});
      db.paymentTransaction.findUnique.mockResolvedValue(null);
      db.userSubscription.findFirst.mockResolvedValue({ userId: 'user-42' });
      db.userSubscription.findUnique.mockResolvedValue(null);

      await svc.handleWebhook(
        sign(JSON.stringify(payload)),
        Buffer.from(JSON.stringify(payload)),
        payload,
      );
      expect(db.userSubscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-42' } }),
      );
    });

    it('returns ignored for a payload without event data', async () => {
      const { svc } = makeSvc();
      const payload = {} as { event: string; data: Record<string, any> };
      const out = await svc.handleWebhook('sig', Buffer.from('{}'), payload);
      expect(out.status).toBe('ignored');
    });
  });

  describe('lifecycle events', () => {
    it('invoice.payment_failed → PAYMENT_FAILED with a grace window', async () => {
      const { svc, db, plans } = makeSvc();
      const payload = {
        event: 'invoice.payment_failed',
        data: { customer: { customer_code: 'CUS_1', email: 'a@b.com' } },
      };
      db.subscriptionWebhookEvent.findUnique.mockResolvedValue(null);
      db.subscriptionWebhookEvent.create.mockResolvedValue({});
      db.user.findUnique.mockResolvedValue({ id: 'user-1' });
      db.userSubscription.findUnique.mockResolvedValue(row());
      plans.getGracePeriodDays.mockReturnValue(3);

      await svc.handleWebhook(
        sign(JSON.stringify(payload)),
        Buffer.from(JSON.stringify(payload)),
        payload,
      );
      const updateCall = db.userSubscription.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe(SubscriptionStatus.PAYMENT_FAILED);
      const graceInMs = updateCall.data.gracePeriodEndsAt.getTime() - Date.now();
      expect(graceInMs).toBeGreaterThan(2.5 * 86_400_000);
      expect(graceInMs).toBeLessThanOrEqual(3 * 86_400_000);
    });

    it('invoice.payment_failed is ignored while a trial is running', async () => {
      const { svc, db } = makeSvc();
      const payload = {
        event: 'invoice.payment_failed',
        data: { customer: { customer_code: null, email: 'a@b.com' } },
      };
      db.subscriptionWebhookEvent.findUnique.mockResolvedValue(null);
      db.subscriptionWebhookEvent.create.mockResolvedValue({});
      db.user.findUnique.mockResolvedValue({ id: 'user-1' });
      db.userSubscription.findUnique.mockResolvedValue(
        row({ status: SubscriptionStatus.TRIALING, planId: 'TRIAL' }),
      );

      await svc.handleWebhook(
        sign(JSON.stringify(payload)),
        Buffer.from(JSON.stringify(payload)),
        payload,
      );
      expect(db.userSubscription.update).not.toHaveBeenCalled();
    });

    it('subscription.not_renew → NON_RENEWING with access until period end', async () => {
      const { svc, db } = makeSvc();
      const payload = {
        event: 'subscription.not_renew',
        data: {
          subscription_code: 'SUB_1',
          next_payment_date: '2026-10-10T12:00:00.000Z',
          customer: { email: 'a@b.com', customer_code: 'CUS_1' },
        },
      };
      db.subscriptionWebhookEvent.findUnique.mockResolvedValue(null);
      db.subscriptionWebhookEvent.create.mockResolvedValue({});
      db.user.findUnique.mockResolvedValue({ id: 'user-1' });
      db.userSubscription.findUnique.mockResolvedValue(row());

      await svc.handleWebhook(
        sign(JSON.stringify(payload)),
        Buffer.from(JSON.stringify(payload)),
        payload,
      );
      const updateCall = db.userSubscription.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe(SubscriptionStatus.NON_RENEWING);
      expect(updateCall.data.cancelAtPeriodEnd).toBe(true);
      expect(updateCall.data.currentPeriodEnd.toISOString()).toBe(
        '2026-10-10T12:00:00.000Z',
      );
    });

    it('subscription.disable → NON_RENEWING (no instant lock-out)', async () => {
      const { svc, db } = makeSvc();
      const payload = {
        event: 'subscription.disable',
        data: { subscription_code: 'SUB_1', customer: { email: 'a@b.com' } },
      };
      db.subscriptionWebhookEvent.findUnique.mockResolvedValue(null);
      db.subscriptionWebhookEvent.create.mockResolvedValue({});
      db.user.findUnique.mockResolvedValue({ id: 'user-1' });
      db.userSubscription.findUnique.mockResolvedValue(row());

      await svc.handleWebhook(
        sign(JSON.stringify(payload)),
        Buffer.from(JSON.stringify(payload)),
        payload,
      );
      expect(db.userSubscription.update.mock.calls[0][0].data.status).toBe(
        SubscriptionStatus.NON_RENEWING,
      );
    });

    it('charge.success with matching period from next_payment_date', async () => {
      const { svc, db } = makeSvc();
      const payload = chargeSuccessPayload('routina_period');
      db.subscriptionWebhookEvent.findUnique.mockResolvedValue(null);
      db.subscriptionWebhookEvent.create.mockResolvedValue({});
      db.userSubscription.findFirst.mockResolvedValue({ userId: 'user-1' });
      db.userSubscription.findUnique.mockResolvedValue(null);

      await svc.handleWebhook(
        sign(JSON.stringify(payload)),
        Buffer.from(JSON.stringify(payload)),
        payload,
      );
      const upsertCall = db.userSubscription.upsert.mock.calls[0][0];
      expect(upsertCall.update).toMatchObject({
        amountNaira: 3000,
        billingInterval: BillingInterval.MONTHLY,
        paystackCustomerCode: 'CUS_1',
        paystackAuthorizationCode: 'AUTH_1',
      });
      expect(upsertCall.update.currentPeriodEnd.toISOString()).toBe(
        '2026-10-10T12:00:00.000Z',
      );
    });
  });
});