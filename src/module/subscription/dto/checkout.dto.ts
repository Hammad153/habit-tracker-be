import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import { PAID_PLANS } from '../plans.config';

export const SUBSCRIBABLE_PLAN_IDS = PAID_PLANS.map((p) => p.id);

export class CheckoutDto {
  @ApiProperty({
    enum: SUBSCRIBABLE_PLAN_IDS,
    example: 'BASIC_MONTHLY',
    description: 'Ember plan id to subscribe to',
  })
  @IsString()
  @IsIn(SUBSCRIBABLE_PLAN_IDS as string[])
  planId: string;
}
