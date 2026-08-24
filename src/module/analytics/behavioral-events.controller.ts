import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { CurrentUser } from '../../core/decorators/current-user.decorator';
import {
  BehavioralEventService,
} from './behavioral-event.service';

class ActionCompletedDto {
  @IsString()
  @Length(6, 64)
  habitId!: string; // server verifies a real completion for this habit
}

class WeeklyReviewViewedDto {
  @IsString()
  @Length(10, 10)
  weekStart!: string; // YYYY-MM-DD Monday key
}

/**
 * Phase 4.1 — narrow, typed event-recording endpoints.
 * No arbitrary event creation: type/userId/outcome/priority are NEVER taken
 * from the client. Every route validates a server-authoritative correlation
 * object before the ledger accepts an observation.
 */
@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics/events')
export class BehavioralEventsController {
  constructor(private readonly eventsSvc: BehavioralEventService) {}

  // ---- Intervention funnel ------------------------------------------------
  @Post('intervention/:fingerprint/viewed')
  interventionViewed(@CurrentUser() userId: string, @Param('fingerprint') fp: string) {
    return this.eventsSvc.recordInterventionInteraction(userId, fp, 'INTERVENTION_VIEWED');
  }

  @Post('intervention/:fingerprint/dismissed')
  interventionDismissed(@CurrentUser() userId: string, @Param('fingerprint') fp: string) {
    return this.eventsSvc.recordInterventionInteraction(userId, fp, 'INTERVENTION_DISMISSED');
  }

  @Post('intervention/:fingerprint/action-started')
  interventionActionStarted(@CurrentUser() userId: string, @Param('fingerprint') fp: string) {
    return this.eventsSvc.recordInterventionInteraction(
      userId, fp, 'INTERVENTION_ACTION_STARTED',
    );
  }

  /** Server-verified: only succeeds when the habit is actually completed today. */
  @Post('intervention/:fingerprint/action-completed')
  interventionActionCompleted(
    @CurrentUser() userId: string,
    @Param('fingerprint') fp: string,
  ) {
    return this.eventsSvc.recordInterventionInteraction(
      userId, fp, 'INTERVENTION_ACTION_COMPLETED',
    );
  }

  // ---- Notification funnel -------------------------------------------------
  @Post('notification/:deliveryId/opened')
  notificationOpened(@CurrentUser() userId: string, @Param('deliveryId') id: string) {
    return this.eventsSvc.recordNotificationInteraction(userId, id, 'NOTIFICATION_OPENED');
  }

  @Post('notification/:deliveryId/dismissed')
  notificationDismissed(@CurrentUser() userId: string, @Param('deliveryId') id: string) {
    return this.eventsSvc.recordNotificationInteraction(userId, id, 'NOTIFICATION_DISMISSED');
  }

  @Post('notification/:deliveryId/action-started')
  notificationActionStarted(@CurrentUser() userId: string, @Param('deliveryId') id: string) {
    return this.eventsSvc.recordNotificationInteraction(userId, id, 'NOTIFICATION_ACTION_STARTED');
  }

  @Post('notification/:deliveryId/action-completed')
  notificationActionCompleted(@CurrentUser() userId: string, @Param('deliveryId') id: string) {
    return this.eventsSvc.recordNotificationInteraction(userId, id, 'NOTIFICATION_ACTION_COMPLETED');
  }

  // ---- Adaptive proposal ----------------------------------------------------
  @Post('proposal/:proposalId/viewed')
  proposalViewed(@CurrentUser() userId: string, @Param('proposalId') id: string) {
    return this.eventsSvc.recordProposalEvent(userId, id, 'ADAPTIVE_PROPOSAL_VIEWED');
  }

  // ---- Weekly review ----------------------------------------------------------
  @Post('weekly-review/viewed')
  weeklyReviewViewed(@CurrentUser() userId: string, @Body() body: WeeklyReviewViewedDto) {
    return this.eventsSvc.recordWeeklyReviewViewed(userId, body.weekStart);
  }
}
