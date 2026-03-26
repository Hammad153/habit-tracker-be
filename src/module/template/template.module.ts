import { Module } from '@nestjs/common';
import { TemplateController } from './template.controller';
import { TemplateService } from './template.service';
import { DatabaseService } from '../../core/database/database.service';

@Module({
  controllers: [TemplateController],
  providers: [TemplateService, DatabaseService],
  exports: [TemplateService],
})
export class TemplateModule {}
