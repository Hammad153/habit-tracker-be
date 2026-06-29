import { Controller, Get, Header } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ExportService } from './export.service';
import { CurrentUser } from '../../core/decorators/current-user.decorator';

@ApiTags('Export')
@ApiBearerAuth()
@Controller('export')
export class ExportController {
  constructor(private readonly exportSvc: ExportService) {}

  @Get('csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="habits-export.csv"')
  getCsv(@CurrentUser() userId: string): Promise<string> {
    return this.exportSvc.getCsv(userId);
  }

  @Get('json')
  getJson(@CurrentUser() userId: string) {
    return this.exportSvc.getJson(userId);
  }
}
