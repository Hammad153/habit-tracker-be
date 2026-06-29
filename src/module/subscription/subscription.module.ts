import { Module } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';
import { DatabaseService } from '../../core/database/database.service';

@Module({
  controllers: [SubscriptionController],
  providers: [SubscriptionService, DatabaseService],
})
export class SubscriptionModule {}
