import { Module } from '@nestjs/common';
import { DatabaseService } from '../../core/database/database.service';
import { DailyPlanController } from './daily-plan.controller';
import { DailyPlanService } from './daily-plan.service';

@Module({
  controllers: [DailyPlanController],
  providers: [DailyPlanService, DatabaseService],
})
export class DailyPlanModule {}
