import { Module } from '@nestjs/common';
import { AiProviderModule } from '../../core/ai/ai-provider.module';
import { IdentityModule } from '../identity/identity.module';
import { AnalyticsService } from './analytics.service';
import { HabitAnalyticsService } from './habit-analytics.service';
import { WeeklyReviewService } from './weekly-review.service';
import { AnalyticsController } from './analytics.controller';
import { WeeklyReviewController } from './weekly-review.controller';
import { DatabaseService } from '../../core/database/database.service';

@Module({
  imports: [AiProviderModule, IdentityModule],
  controllers: [AnalyticsController, WeeklyReviewController],
  providers: [AnalyticsService, HabitAnalyticsService, WeeklyReviewService, DatabaseService],
  exports: [HabitAnalyticsService],
})
export class AnalyticsModule {}
