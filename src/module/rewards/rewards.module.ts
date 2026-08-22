import { Global, Module } from '@nestjs/common';
import { RewardsService } from './rewards.service';
import { RewardEngineService } from './reward-engine.service';
import { RewardsController } from './rewards.controller';
import { StreakFreezeService } from './streak-freeze.service';

@Global()
@Module({
  controllers: [RewardsController],
  providers: [RewardsService, RewardEngineService, StreakFreezeService],
  exports: [RewardsService, RewardEngineService, StreakFreezeService],
})
export class RewardsModule {}
