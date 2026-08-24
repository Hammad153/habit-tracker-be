import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../core/decorators/current-user.decorator';
import { MarkDeliveredDto } from './dto/candidates.dto';
import {
  NotificationCandidatesService,
} from './notification-candidates.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly candidatesSvc: NotificationCandidatesService) {}

  /**
   * Deterministic notification candidates for the authenticated user.
   * Pure read — the client confirms scheduling via POST /delivered.
   */
  @Get('candidates')
  getCandidates(@CurrentUser() userId: string) {
    return this.candidatesSvc.getCandidates(userId);
  }

  /** Idempotent delivery confirmation (unique userId+fingerprint). */
  @Post('delivered')
  markDelivered(@CurrentUser() userId: string, @Body() body: MarkDeliveredDto) {
    return this.candidatesSvc.markDelivered(userId, body.items as never);
  }
}
