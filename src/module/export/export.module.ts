import { Module } from '@nestjs/common';
import { ExportController } from './export.controller';
import { DatabaseService } from '../../core/database/database.service';

@Module({
  controllers: [ExportController],
  providers: [DatabaseService],
})
export class ExportModule {}
