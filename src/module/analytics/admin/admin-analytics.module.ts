import { Module } from '@nestjs/common';
import { AiProviderModule } from '../../../core/ai/ai-provider.module';
import { DatabaseService } from '../../../core/database/database.service';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminDashboardService } from './admin-dashboard.service';
import { BehavioralEventService } from '../behavioral-event.service';

@Module({
  imports: [AiProviderModule],
  controllers: [AdminAnalyticsController],
  providers: [AdminAnalyticsService, AdminDashboardService, DatabaseService, BehavioralEventService],
})
export class AdminAnalyticsModule {}
