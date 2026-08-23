import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AiProviderModule } from '../../core/ai/ai-provider.module';
import { DatabaseService } from '../../core/database/database.service';
import { InterventionController } from './intervention.controller';
import { InterventionService } from './intervention.service';
import { CoachService } from './coach.service';

@Module({
  imports: [AnalyticsModule, AiProviderModule],
  controllers: [InterventionController],
  providers: [InterventionService, DatabaseService, CoachService],
})
export class InterventionModule {}
