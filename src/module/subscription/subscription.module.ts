import { Module } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionWebhookService } from './webhook.service';
import { PaystackService } from './paystack.service';
import { PlanRegistry } from './plans.config';
import { SubscriptionAccessGuard } from './subscription-access.guard';
import { DatabaseService } from '../../core/database/database.service';
import { ConfigService } from '@nestjs/config';

@Module({
  controllers: [SubscriptionController],
  providers: [
    SubscriptionService,
    SubscriptionWebhookService,
    PaystackService,
    PlanRegistry,
    SubscriptionAccessGuard,
    DatabaseService,
    ConfigService,
  ],
  exports: [SubscriptionService, PlanRegistry, SubscriptionAccessGuard],
})
export class SubscriptionModule {}