import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  SubscriptionService,
  SubscriptionTier,
} from './subscription.service';

@ApiTags('Subscription')
@Controller('subscription')
export class SubscriptionController {
  constructor(private readonly subscriptionSvc: SubscriptionService) {}

  @Get()
  get(@Query('userId') userId: string) {
    return this.subscriptionSvc.get(userId);
  }

  @Patch()
  update(@Body() body: { userId: string; tier: SubscriptionTier }) {
    return this.subscriptionSvc.update(body?.userId, body?.tier);
  }
}
