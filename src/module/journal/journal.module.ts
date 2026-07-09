import { Module } from '@nestjs/common';
import { DatabaseService } from '../../core/database/database.service';
import { JournalController } from './journal.controller';
import { JournalService } from './journal.service';

@Module({
  controllers: [JournalController],
  providers: [JournalService, DatabaseService],
})
export class JournalModule {}
