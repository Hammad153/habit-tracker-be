import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../core/decorators/current-user.decorator';
import { AdaptiveService } from './adaptive.service';

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics/habits')
export class AdaptiveOutcomeController {
  constructor(private readonly adaptiveSvc: AdaptiveService) {}

  /** Adaptation effectiveness for one habit (Phase 3.6 §14). */
  @Get(':id/adaptation-outcomes')
  getOutcomes(@CurrentUser() userId: string, @Param('id') habitId: string) {
    return this.adaptiveSvc.getAdaptationOutcomes(userId, habitId);
  }
}
