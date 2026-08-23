import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { HabitAnalyticsService } from './habit-analytics.service';
import { CurrentUser } from '../../core/decorators/current-user.decorator';

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsSvc: AnalyticsService,
    private readonly habitAnalyticsSvc: HabitAnalyticsService,
  ) {}

  @Get('overview')
  getOverview(@CurrentUser() userId: string) {
    return this.analyticsSvc.getOverview(userId);
  }

  /** Deterministic behavior report for one habit (Phase 3.1). */
  @Get('habits/:id')
  getHabitBehavior(
    @CurrentUser() userId: string,
    @Param('id') habitId: string,
    @Query('date') date?: string,
  ) {
    return this.habitAnalyticsSvc.getHabitBehaviorReport(userId, habitId, date);
  }

  /** Compact risk/momentum view for UI badges. */
  @Get('habits/:id/risk')
  getHabitRisk(
    @CurrentUser() userId: string,
    @Param('id') habitId: string,
    @Query('date') date?: string,
  ) {
    return this.habitAnalyticsSvc.getHabitRisk(userId, habitId, date);
  }
}
