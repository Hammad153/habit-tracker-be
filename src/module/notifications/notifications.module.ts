import { Module } from '@nestjs/common';
import { AiProviderModule } from '../../core/ai/ai-provider.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { DatabaseService } from '../../core/database/database.service';
import { NotificationsController } from './notifications.controller';
import { NotificationCandidatesService } from './notification-candidates.service';

@Module({
  imports: [AnalyticsModule, AiProviderModule],
  controllers: [NotificationsController],
  providers: [NotificationCandidatesService, DatabaseService],
})
export class NotificationsModule {}
