import { Module } from '@nestjs/common';
import { DatabaseService } from '../../core/database/database.service';
import { AwardsModule } from '../awards/awards.module';
import { ProfileModule } from '../profile/profile.module';
import { DailyPlanController } from './daily-plan.controller';
import { DailyPlanService } from './daily-plan.service';

@Module({
  imports: [ProfileModule, AwardsModule],
  controllers: [DailyPlanController],
  providers: [DailyPlanService, DatabaseService],
})
export class DailyPlanModule {}
