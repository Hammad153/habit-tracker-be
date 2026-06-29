import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import type { SubscriptionTier } from '../subscription.service';

export const SUBSCRIPTION_TIERS: SubscriptionTier[] = [
  'FREE',
  'BASIC',
  'PREMIUM',
];

export class UpdateSubscriptionDto {
  @ApiProperty({ enum: SUBSCRIPTION_TIERS, example: 'PREMIUM' })
  @IsIn(SUBSCRIPTION_TIERS)
  tier: SubscriptionTier;
}
