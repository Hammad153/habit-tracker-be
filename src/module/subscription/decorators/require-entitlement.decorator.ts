import { SetMetadata } from '@nestjs/common';
import type { FeatureKey } from '../plans.config';

/**
 * Requires a specific paid feature entitlement for the route. Enforced by the
 * global SubscriptionAccessGuard (server-authoritative). Example:
 *
 *   @RequireEntitlement('aiCoach')
 *   getCoach(@CurrentUser() userId: string) { ... }
 */
export const REQUIRED_ENTITLEMENT_KEY = 'required_entitlement';

export const RequireEntitlement = (feature: FeatureKey) =>
  SetMetadata(REQUIRED_ENTITLEMENT_KEY, feature);