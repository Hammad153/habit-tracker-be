import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SubscriptionService } from './subscription.service';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { CurrentUser } from '../../core/decorators/current-user.decorator';

@ApiTags('Subscription')
@ApiBearerAuth()
@Controller('subscription')
export class SubscriptionController {
  constructor(private readonly subscriptionSvc: SubscriptionService) {}

  @Get()
  get(@CurrentUser() userId: string) {
    return this.subscriptionSvc.get(userId);
  }

  @Patch()
  update(@CurrentUser() userId: string, @Body() body: UpdateSubscriptionDto) {
    return this.subscriptionSvc.update(userId, body.tier);
  }
}
