import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { CurrentUser } from '../../core/decorators/current-user.decorator';

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsSvc: AnalyticsService) {}

  @Get('overview')
  getOverview(@CurrentUser() userId: string) {
    return this.analyticsSvc.getOverview(userId);
  }
}
