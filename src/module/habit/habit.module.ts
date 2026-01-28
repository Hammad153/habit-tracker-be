import { Module } from '@nestjs/common';
import { HabitService } from './habit.service';
import { HabitController } from './habit.controller';
import { DatabaseService } from 'src/core/database/database.service';

@Module({
  controllers: [HabitController],
  providers: [HabitService, DatabaseService],
})
export class HabitModule {}
