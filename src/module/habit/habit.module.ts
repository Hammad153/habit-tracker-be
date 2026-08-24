import { Module } from '@nestjs/common';
import { HabitService } from './habit.service';
import { HabitController } from './habit.controller';
import { AdaptiveService } from './adaptive.service';
import { DatabaseService } from '../../core/database/database.service';
import { ProfileModule } from '../profile/profile.module';
import { AwardsModule } from '../awards/awards.module';
import { RewardsModule } from '../rewards/rewards.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AiProviderModule } from '../../core/ai/ai-provider.module';

@Module({
  imports: [ProfileModule, AwardsModule, RewardsModule, AnalyticsModule, AiProviderModule],
  controllers: [HabitController],
  providers: [HabitService, AdaptiveService, DatabaseService],
})
export class HabitModule {}
