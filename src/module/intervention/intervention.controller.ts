import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentUser } from '../../core/decorators/current-user.decorator';
import { InterventionService } from './intervention.service';

@Controller('analytics/habits')
export class InterventionController {
  constructor(private readonly interventionSvc: InterventionService) {}

  /**
   * The single recommended intervention for this habit (or null).
   * Deterministic for a given date; `?date=YYYY-MM-DD` optional.
   */
  @Get(':id/intervention')
  getIntervention(
    @CurrentUser() userId: string,
    @Param('id') habitId: string,
    @Query('date') date?: string,
  ) {
    return this.interventionSvc.getForHabit(userId, habitId, date);
  }
}
