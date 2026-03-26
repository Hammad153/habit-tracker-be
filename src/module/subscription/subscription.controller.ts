import { Controller, Get, Patch, Body, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SubscriptionService } from './subscription.service';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

@ApiTags('Subscription')
@Controller('subscription')
export class SubscriptionController {
  constructor(private readonly subscriptionSvc: SubscriptionService) {}

  @Get()
  getUserTier(@Query('userId') userId: string) {
    return this.subscriptionSvc.getUserTier(userId);
  }

  @Patch()
  updateTier(@Body() { userId, tier }: UpdateSubscriptionDto) {
    return this.subscriptionSvc.updateTier(userId, tier);
  }
}
