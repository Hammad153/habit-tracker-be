import { Module } from '@nestjs/common';
import { AiProviderModule } from '../../core/ai/ai-provider.module';
import { IdentityModule } from '../identity/identity.module';
import { AnalyticsService } from './analytics.service';
import { HabitAnalyticsService } from './habit-analytics.service';
import { WeeklyReviewService } from './weekly-review.service';
import { PortfolioOverloadService } from './portfolio-overload.service';
import { BehavioralEventService } from './behavioral-event.service';
import { BehavioralEventsController } from './behavioral-events.controller';
import { AdminAnalyticsModule } from './admin/admin-analytics.module';
import { AnalyticsController } from './analytics.controller';
import { WeeklyReviewController } from './weekly-review.controller';
import { DatabaseService } from '../../core/database/database.service';

@Module({
  imports: [AiProviderModule, IdentityModule, AdminAnalyticsModule],
  controllers: [AnalyticsController, WeeklyReviewController, BehavioralEventsController],
  providers: [AnalyticsService, HabitAnalyticsService, WeeklyReviewService, PortfolioOverloadService, BehavioralEventService, DatabaseService],
  exports: [HabitAnalyticsService, BehavioralEventService],
})
export class AnalyticsModule {}
