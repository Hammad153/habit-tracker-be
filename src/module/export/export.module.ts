import { Module } from '@nestjs/common';
import { ExportService } from './export.service';
import { ExportController } from './export.controller';
import { DatabaseService } from '../../core/database/database.service';

@Module({
  controllers: [ExportController],
  providers: [ExportService, DatabaseService],
})
export class ExportModule {}
