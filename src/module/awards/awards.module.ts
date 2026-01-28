import { Module } from '@nestjs/common';
import { AwardsService } from './awards.service';
import { AwardsController } from './awards.controller';
import { DatabaseService } from 'src/core/database/database.service';

@Module({
  controllers: [AwardsController],
  providers: [AwardsService, DatabaseService],
})
export class AwardsModule {}
