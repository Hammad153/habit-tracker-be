import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString } from 'class-validator';
import { SubscriptionTier } from '@prisma/client';

export class UpdateSubscriptionDto {
  @ApiProperty({
    example: 'user-id',
    description: 'The ID of the user',
  })
  @IsString()
  userId: string;

  @ApiProperty({
    enum: SubscriptionTier,
    example: 'BASIC',
    description: 'The subscription tier to set',
  })
  @IsEnum(SubscriptionTier)
  tier: SubscriptionTier;
}
