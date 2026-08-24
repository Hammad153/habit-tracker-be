import { Module } from '@nestjs/common';
import { DatabaseService } from '../../../core/database/database.service';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { AdminAnalyticsService } from './admin-analytics.service';

@Module({
  controllers: [AdminAnalyticsController],
  providers: [AdminAnalyticsService, DatabaseService],
})
export class AdminAnalyticsModule {}
