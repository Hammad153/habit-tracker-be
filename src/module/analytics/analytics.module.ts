import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { DatabaseService } from '../../core/database/database.service';

@Module({
  controllers: [AnalyticsController],
  providers: [DatabaseService],
})
export class AnalyticsModule {}
