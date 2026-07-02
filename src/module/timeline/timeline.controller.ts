import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TimelineService } from './timeline.service';
import { CurrentUser } from '../../core/decorators/current-user.decorator';

@ApiTags('Timeline')
@ApiBearerAuth()
@Controller('timeline')
export class TimelineController {
  constructor(private readonly timelineService: TimelineService) {}

  @Get()
  getTimeline(@CurrentUser() userId: string) {
    return this.timelineService.getTimeline(userId);
  }
}
