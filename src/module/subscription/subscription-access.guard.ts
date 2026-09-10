import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../core/decorators/public.decorator';
import { SUBSCRIPTION_GATE_BYPASS_KEY } from './decorators/bypass-subscription-gate.decorator';
import { REQUIRED_ENTITLEMENT_KEY } from './decorators/require-entitlement.decorator';
import { SubscriptionService } from './subscription.service';
import type { FeatureKey } from './plans.config';

/**
 * Server-authoritative subscription paywall.
 *
 * Runs after Throttler -> Auth -> Roles. Every authenticated, non-public route
 * is gated unless it carries @BypassSubscriptionGate():
 *  - EXPIRED (trial or subscription) -> 403 SUBSCRIPTION_REQUIRED. The user can
 *    still reach subscription/pricing, account, and profile routes.
 *  - TRIALING / ACTIVE / NON_RENEWING / PAST_DUE / PAYMENT_FAILED (grace) -> passed.
 *  - @RequireEntitlement('aiCoach') etc. additionally blocks features a paid
 *    plan does not include (server-side — frontend guards are cosmetic only).
 *
 * A developer bypass exists ONLY via SUBSCRIPTION_DEV_BYPASS=true (default
 * off); production never grants free bypass.
 */
@Injectable()
export class SubscriptionAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptionSvc: SubscriptionService,
    private readonly configSvc: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request?.user?.sub;
    if (!userId) return true; // AuthGuard enforces authentication.

    if (this.devBypassEnabled()) return true;

    const bypass = this.reflector.getAllAndOverride<boolean>(
      SUBSCRIPTION_GATE_BYPASS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const required = this.reflector.getAllAndOverride<FeatureKey>(
      REQUIRED_ENTITLEMENT_KEY,
      [context.getHandler(), context.getClass()],
    );

    const resolution = await this.subscriptionSvc.getEffectiveSubscription(
      userId,
    );

    if (!bypass && !resolution.accessGranted) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTION_REQUIRED',
        message:
          'Your free trial has ended. Choose a plan to continue using Routina.',
      });
    }

    if (required && resolution.accessGranted) {
      const entitled = resolution.entitlements[required];
      if (!entitled) {
        throw new ForbiddenException({
          code: 'ENTITLEMENT_REQUIRED',
          message: `This feature is included with Premium. Upgrade to continue.`,
        });
      }
    }

    return true;
  }

  private devBypassEnabled(): boolean {
    return String(this.configSvc.get<string>('SUBSCRIPTION_DEV_BYPASS')) === 'true';
  }
}