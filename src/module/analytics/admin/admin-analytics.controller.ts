import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Roles } from '../../../core/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminEffectivenessQueryDto } from './dto/admin-effectiveness-query.dto';

/**
 * Phase 3.8 — ADMIN-only behavioral intelligence.
 * Aggregate, privacy-floored, read-only. No AI, no threshold mutation.
 */
@ApiTags('Admin Analytics')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@ApiForbiddenResponse({ description: 'Requires ADMIN role' })
@Controller('analytics/admin')
export class AdminAnalyticsController {
  constructor(private readonly adminAnalyticsSvc: AdminAnalyticsService) {}

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
