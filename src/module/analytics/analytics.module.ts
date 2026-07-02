import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { DatabaseService } from '../../core/database/database.service';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, DatabaseService],
})
export class AnalyticsModule {}
