import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { DatabaseService } from '../../core/database/database.service';
import { InterventionController } from './intervention.controller';
import { InterventionService } from './intervention.service';

@Module({
  imports: [AnalyticsModule],
  controllers: [InterventionController],
  providers: [InterventionService, DatabaseService],
})
export class InterventionModule {}
