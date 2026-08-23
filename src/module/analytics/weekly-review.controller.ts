import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, Matches } from 'class-validator';
import { CurrentUser } from '../../core/decorators/current-user.decorator';
import { WeeklyReviewService } from './weekly-review.service';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export class WeekQueryDto {
  @IsOptional()
  @IsString()
  @Matches(DATE_KEY, { message: 'week must be formatted as YYYY-MM-DD' })
  week?: string;
}

export class RegenerateWeekDto {
  @IsOptional()
  @IsString()
  @Matches(DATE_KEY, { message: 'week must be formatted as YYYY-MM-DD' })
  week?: string;
}

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics')
export class WeeklyReviewController {
  constructor(private readonly weeklyReviewSvc: WeeklyReviewService) {}

  /** Weekly behavioral review for the user's timezone (spec §13). */
  @Get('weekly-review')
  getWeeklyReview(
    @CurrentUser() userId: string,
    @Query() query: WeekQueryDto,
  ) {
    return this.weeklyReviewSvc.getWeeklyReview(userId, query.week);
  }

  /** Deliberate regeneration of a completed week — throttled harder. */
  @Throttle({ short: { limit: 1, ttl: 60_000 }, long: { limit: 5, ttl: 3_600_000 } })
  @Post('weekly-review/regenerate')
  regenerate(@CurrentUser() userId: string, @Body() body: RegenerateWeekDto) {
    return this.weeklyReviewSvc.regenerateWeeklyReview(userId, body.week);
  }
}
