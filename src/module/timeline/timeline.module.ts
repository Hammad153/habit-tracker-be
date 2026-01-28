import { Module } from '@nestjs/common';
import { TimelineService } from './timeline.service';
import { TimelineController } from './timeline.controller';
import { DatabaseService } from 'src/core/database/database.service';

@Module({
  controllers: [TimelineController],
  providers: [TimelineService, DatabaseService],
})
export class TimelineModule {}
