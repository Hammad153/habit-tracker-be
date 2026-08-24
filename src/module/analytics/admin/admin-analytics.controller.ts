import { Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiPropertyOptional, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Roles } from '../../../core/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminDashboardService } from './admin-dashboard.service';
import { Throttle } from '@nestjs/throttler';
import { BehavioralEventService } from '../behavioral-event.service';
import { AdminEffectivenessQueryDto } from './dto/admin-effectiveness-query.dto';

class DashboardPeriodQueryDto {
  @ApiPropertyOptional({ example: '2026-08-17', description: 'Range start (inclusive). Defaults to the previous completed week.' })
  from?: string;
  @ApiPropertyOptional({ example: '2026-08-23', description: 'Range end (inclusive). Max 180 days.' })
  to?: string;
}

@ApiTags('Admin Analytics')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@ApiForbiddenResponse({ description: 'Requires ADMIN role' })
@Controller('analytics/admin')
export class AdminAnalyticsController {
  constructor(
    private readonly adminAnalyticsSvc: AdminAnalyticsService,
    private readonly dashboardSvc: AdminDashboardService,
    private readonly behavioralEvents: BehavioralEventService,
  ) {}

  @Roles(Role.ADMIN)
  @Throttle({ short: { limit: 1, ttl: 60_000 }, long: { limit: 4, ttl: 3_600_000 } })
  @Post('events/prune')
  pruneEvents() {
    return this.behavioralEvents.pruneExpiredEvents();
  }

  @Get('dashboard')
  getDashboard(@Query() query: DashboardPeriodQueryDto) {
    return this.dashboardSvc.getDashboard(query.from, query.to);
  }

  /** Optional NVIDIA wording over already-computed facts (language only). */
  @Get('dashboard/summary')
  getDashboardSummary(@Query() query: DashboardPeriodQueryDto) {
    return this.dashboardSvc.getDashboardSummary(query.from, query.to);
  }

  /** TUNING INSIGHT source — observation only, never automatic mutation. */
  @Get('adaptation-effectiveness')
  getAdaptationEffectiveness(@Query() query: AdminEffectivenessQueryDto) {
    return this.adminAnalyticsSvc.getAdaptationEffectiveness(
      query.from,
      query.to,
    );
  }

  @Get('overview')
  getOverview() {
    return this.adminAnalyticsSvc.getOverview();
  }
}
