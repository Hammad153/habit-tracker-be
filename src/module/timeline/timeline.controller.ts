import { Controller, Get, Query } from '@nestjs/common';
import { TimelineService } from './timeline.service';

@Controller('timeline')
export class TimelineController {
  constructor(private readonly timelineService: TimelineService) {}

  @Get()
  getTimeline(@Query('userId') userId: string) {
    return this.timelineService.getTimeline(userId || 'default-user');
  }
}
