import { Controller, Get, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../core/decorators/current-user.decorator';
import { InterventionService } from './intervention.service';
import { CoachService } from './coach.service';

@Controller('analytics/habits')
export class InterventionController {
  constructor(
    private readonly interventionSvc: InterventionService,
    private readonly coachSvc: CoachService,
  ) {}

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

  /**
   * AI-coached view of the deterministic intervention (Phase 3.3).
   * Every request can consume external inference quota, so this endpoint
   * carries a stricter throttle than the global default (spec §34).
   */
  @Throttle({ short: { limit: 3, ttl: 1000 }, long: { limit: 20, ttl: 60_000 } })
  @Get(':id/coach')
  getCoach(
    @CurrentUser() userId: string,
    @Param('id') habitId: string,
    @Query('date') date?: string,
  ) {
    return this.coachSvc.getCoachForHabit(userId, habitId, date);
  }
}
