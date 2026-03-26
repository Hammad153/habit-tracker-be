import { Module } from '@nestjs/common';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { DatabaseService } from '../../core/database/database.service';

@Module({
  controllers: [SubscriptionController],
  providers: [SubscriptionService, DatabaseService],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
