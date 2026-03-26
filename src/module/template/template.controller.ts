import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TemplateService } from './template.service';

@ApiTags('Templates')
@Controller('template')
export class TemplateController {
  constructor(private readonly templateSvc: TemplateService) {}

  @Get()
  findAll() {
    return this.templateSvc.findAll();
  }

  @Get('categories')
  getCategories() {
    return this.templateSvc.getCategories();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.templateSvc.findOne(id);
  }
}
