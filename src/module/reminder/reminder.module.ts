import { Module } from '@nestjs/common';
import { ReminderController } from './reminder.controller';
import { ReminderService } from './reminder.service';
import { DatabaseService } from '../../core/database/database.service';

@Module({
  controllers: [ReminderController],
  providers: [ReminderService, DatabaseService],
  exports: [ReminderService],
})
export class ReminderModule {}
