import { Module } from '@nestjs/common';
import { HabitService } from './habit.service';
import { HabitController } from './habit.controller';
import { DatabaseService } from '../../core/database/database.service';
import { ProfileModule } from '../profile/profile.module';
import { AwardsModule } from '../awards/awards.module';
import { RewardsModule } from '../rewards/rewards.module';

@Module({
  imports: [ProfileModule, AwardsModule, RewardsModule],
  controllers: [HabitController],
  providers: [HabitService, DatabaseService],
})
export class HabitModule {}
