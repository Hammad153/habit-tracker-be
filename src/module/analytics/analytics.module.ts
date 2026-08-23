import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { HabitAnalyticsService } from './habit-analytics.service';
import { AnalyticsController } from './analytics.controller';
import { DatabaseService } from '../../core/database/database.service';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, HabitAnalyticsService, DatabaseService],
  exports: [HabitAnalyticsService],
})
export class AnalyticsModule {}
