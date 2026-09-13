import type { Request } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SubscriptionService } from './subscription.service';
import { SubscriptionWebhookService } from './webhook.service';
import { CheckoutDto } from './dto/checkout.dto';
import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { CurrentUser } from '../../core/decorators/current-user.decorator';
import { Public } from '../../core/decorators/public.decorator';
import { BypassSubscriptionGate } from './decorators/bypass-subscription-gate.decorator';

/**
 * Subscription, pricing, and Paystack endpoints.
 *
 * Class-level @BypassSubscriptionGate() means an expired-trial user can still
 * reach this controller (to see pricing, choose a plan, and pay) — the global
 * paywall is intentionally powering this surface.
 */
@ApiTags('Subscription')
@ApiBearerAuth()
@Controller('subscription')
@BypassSubscriptionGate()
export class SubscriptionController {
  constructor(
    private readonly subscriptionSvc: SubscriptionService,
    private readonly webhookSvc: SubscriptionWebhookService,
  ) {}

  @Get()
  get(@CurrentUser() userId: string) {
    return this.subscriptionSvc.getInfo(userId);
  }

  /** Centralized pricing — the frontend renders amounts from here (₦ NGN). */
  @Get('plans')
  getPlans() {
    return this.subscriptionSvc.getPlans();
  }

  /** Initialize a Paystack plan-backed checkout for the authenticated user. */
  @Post('checkout')
  checkout(@CurrentUser() userId: string, @Body() dto: CheckoutDto) {
    return this.subscriptionSvc.checkout(userId, dto.planId);
  }

  /** Server-side payment verification (authoritative, webhook-independent). */
  @Post('verify')
  verify(@CurrentUser() userId: string, @Body() dto: VerifyPaymentDto) {
    return this.subscriptionSvc.verify(userId, dto.reference);
  }

  /** Cancel future renewal; access continues until the paid period ends. */
  @Post('cancel')
  cancel(@CurrentUser() userId: string) {
    return this.subscriptionSvc.cancel(userId);
  }

  /** Resume renewal before the paid period ends. */
  @Post('resume')
  resume(@CurrentUser() userId: string) {
    return this.subscriptionSvc.resume(userId);
  }

  @Get('transactions')
  transactions(@CurrentUser() userId: string) {
    return this.subscriptionSvc.listTransactions(userId);
  }

  /**
   * Paystack webhook. Public by design (Paystack has no token), throttling is
   * skipped so retries are never dropped, and the signature is verified over
   * the raw body. Returns 200 quickly after recording the event idempotently.
   */
  @SkipThrottle()
  @Public()
  @Post('paystack/webhook')
  async paystackWebhook(
    @Req() req: Request,
    @Headers('x-paystack-signature') signature: string | undefined,
  ) {
    const rawBody = (req as any).rawBody as Buffer | undefined;
    if (!this.webhookSvc.verifySignature(signature, rawBody, req.body)) {
      throw new UnauthorizedException({
        code: 'WEBHOOK_SIGNATURE_INVALID',
        message: 'Invalid Paystack webhook signature',
      });
    }
    return this.webhookSvc.handleWebhook(signature, rawBody, req.body as any);
  }
}
