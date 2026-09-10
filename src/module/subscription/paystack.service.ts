import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface InitializeTransactionParams {
  email: string;
  /** Minor unit (kobo) — Paystack requires NGN amounts in kobo. */
  amountMinor: number;
  planCode: string;
  reference: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

interface InitializeResponse {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

interface VerifyResponse {
  success: boolean;
  paidAt?: string;
  channel?: string;
  customerCode?: string;
  authorizationCode?: string;
  subscriptionCode?: string;
  plan: Record<string, unknown>;
  raw: Record<string, unknown>;
}

/**
 * Thin, typed client for Paystack's official REST API (subscriptions are
 * created through Paystack plans + transaction initialize — we never invent a
 * custom recurring-billing engine). Webhook signature verification lives in
 * SubscriptionWebhookService.
 *
 * The secret key is server-only and is never exposed to the frontend.
 */
@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);

  constructor(private readonly configSvc: ConfigService) {}

  getApiKey(): string {
    return this.configSvc.get<string>('PAYSTACK_SECRET_KEY')?.trim() || '';
  }

  isConfigured(): boolean {
    const key = this.getApiKey();
    return Boolean(
      key && (key.startsWith('sk_test_') || key.startsWith('sk_live_')),
    );
  }

  private auth(): Record<string, string> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException({
        code: 'PAYMENTS_NOT_CONFIGURED',
        message:
          'Payments are not configured yet. Please set PAYSTACK_SECRET_KEY and the plan codes.',
      });
    }
    return { Authorization: `Bearer ${this.getApiKey()}` };
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    headers: Record<string, string>,
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(`https://api.paystack.co${path}`, {
        method,
        headers: { ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new ServiceUnavailableException({
          code: `PAYSTACK_HTTP_${res.status}`,
          message: text || `Paystack HTTP ${res.status}`,
        });
      }
      return (await res.json()) as T;
    } catch (err: any) {
      if (
        err instanceof ServiceUnavailableException ||
        err?.name === 'AbortError'
      ) {
        throw err;
      }
      throw new ServiceUnavailableException({
        code: 'PAYSTACK_UNREACHABLE',
        message: err?.message || 'Paystack request failed',
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Initialize a plan-backed checkout. When `plan` is supplied Paystack creates
   * the recurring subscription for the customer on successful payment.
   */
  async initializeTransaction(
    params: InitializeTransactionParams,
  ): Promise<InitializeResponse> {
    const data = await this.request<any>(
      'POST',
      '/transaction/initialize',
      this.auth(),
      {
        email: params.email,
        amount: params.amountMinor,
        plan: params.planCode,
        reference: params.reference,
        callback_url: params.callbackUrl,
        metadata: params.metadata,
        currency: 'NGN',
      },
    );
    if (!data?.status) {
      this.logger.warn(
        `Paystack initialize failed: ${data?.message ?? 'no message'}`,
      );
      throw new ServiceUnavailableException({
        code: 'PAYSTACK_INITIALIZE_FAILED',
        message: data?.message || 'Could not initialize payment.',
      });
    }
    return {
      authorizationUrl: data.data?.authorization_url as string,
      accessCode: data.data?.access_code as string,
      reference: data.data?.reference as string,
    };
  }

  /** Server-side transaction verification (never trust the browser). */
  async verifyTransaction(reference: string): Promise<VerifyResponse> {
    const data = await this.request<any>(
      'GET',
      `/transaction/verify/${encodeURIComponent(reference)}`,
      this.auth(),
    );
    if (!data?.status || !data.data) {
      throw new ServiceUnavailableException({
        code: 'PAYSTACK_VERIFY_FAILED',
        message: data?.message || 'Could not verify transaction.',
      });
    }
    const d = data.data as any;
    return {
      success: d.status === 'success',
      paidAt: d.paid_at,
      channel: d.channel,
      customerCode: d.customer?.customer_code,
      authorizationCode: d.authorization?.authorization_code,
      subscriptionCode: d.subscription?.subscription_code,
      plan: (d.plan ?? {}) as Record<string, unknown>,
      raw: d as Record<string, unknown>,
    };
  }

  /** Fetch a Paystack subscription to resolve its token / next payment date. */
  async getSubscription(subscriptionCode: string): Promise<any> {
    const data = await this.request<any>(
      'GET',
      `/subscription/${encodeURIComponent(subscriptionCode)}`,
      this.auth(),
    );
    return data?.data;
  }

  /**
   * Best-effort Paystack-side cancellation so no further renewals are charged.
   * Requires the subscription token (returned by GET /subscription/:code).
   */
  async disableSubscription(subscriptionCode: string): Promise<void> {
    const subscription = await this.getSubscription(subscriptionCode);
    const token = subscription?.token;
    if (!token) {
      this.logger.warn(
        `No disable token for subscription ${subscriptionCode}; relying on webhooks.`,
      );
      return;
    }
    const data = await this.request<any>(
      'POST',
      `/subscription/${encodeURIComponent(subscriptionCode)}/disable`,
      this.auth(),
      { code: subscriptionCode, token },
    );
    if (!data?.status) {
      this.logger.warn(
        `Paystack disable failed for ${subscriptionCode}: ${data?.message ?? 'no message'}`,
      );
    }
  }
}