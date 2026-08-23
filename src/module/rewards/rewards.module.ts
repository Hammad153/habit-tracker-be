import { Global, Module } from '@nestjs/common';
import { RewardsService } from './rewards.service';
import { RewardEngineService } from './reward-engine.service';
import { RewardsController } from './rewards.controller';
import { StreakFreezeService } from './streak-freeze.service';
import { TemptationBundleService } from './temptation-bundle.service';
import { TemptationBundleController } from './temptation-bundle.controller';
import { RewardShopService } from './reward-shop.service';
import { RewardShopController } from './reward-shop.controller';
import { DatabaseService } from '../../core/database/database.service';

@Global()
@Module({
  controllers: [
    RewardsController,
    TemptationBundleController,
    RewardShopController,
  ],
  providers: [
    RewardsService,
    RewardEngineService,
    StreakFreezeService,
    TemptationBundleService,
    RewardShopService,
    DatabaseService
  ],
  exports: [
    RewardsService,
    RewardEngineService,
    StreakFreezeService,
    TemptationBundleService,
    RewardShopService,
  ],
})
export class RewardsModule {}
