import { Global, Module } from '@nestjs/common';
import { RewardsService } from './rewards.service';
import { RewardEngineService } from './reward-engine.service';
import { RewardsController } from './rewards.controller';

@Global()
@Module({
  controllers: [RewardsController],
  providers: [RewardsService, RewardEngineService],
  exports: [RewardsService, RewardEngineService],
})
export class RewardsModule {}
