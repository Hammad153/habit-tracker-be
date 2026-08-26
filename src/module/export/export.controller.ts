import { Controller, Get, Header, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
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

  @Get('excel')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="habits-export.xlsx"')
  async getExcel(@CurrentUser() userId: string, @Res() res: Response) {
    const buffer = await this.exportSvc.getExcel(userId);
    res.end(buffer);
  }

  @Get('pdf')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getPdf(@CurrentUser() userId: string): Promise<string> {
    return this.exportSvc.getPdfHtml(userId);
  }
}
