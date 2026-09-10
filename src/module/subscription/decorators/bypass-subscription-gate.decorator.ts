import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route as exempt from the global subscription-access gate (paywall).
 *
 * Used for account-management and payment surfaces so a user whose trial has
 * expired can still log in, view their status, choose a plan, and pay. The
 * AuthGuard (JWT) still applies unless the route is also @Public().
 */
export const SUBSCRIPTION_GATE_BYPASS_KEY = 'subscription_gate_bypass';

export const BypassSubscriptionGate = () =>
  SetMetadata(SUBSCRIPTION_GATE_BYPASS_KEY, true);