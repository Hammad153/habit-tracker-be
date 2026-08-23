import {
  Controller,
  Body,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { TemptationBundleService } from './temptation-bundle.service';
import { CurrentUser } from '../../core/decorators/current-user.decorator';
import {
  CreateTemptationBundleDto,
  UpdateTemptationBundleDto,
} from './dto/temptation-bundle.dto';

class ListBundlesQueryDto {
  @IsOptional()
  @IsString()
  habitId?: string;
}

@ApiTags('Temptation Bundles')
@ApiBearerAuth()
@Controller('temptation-bundle')
export class TemptationBundleController {
  constructor(private readonly bundlesSvc: TemptationBundleService) {}

  @Post()
  create(@Body() dto: CreateTemptationBundleDto, @CurrentUser() userId: string) {
    return this.bundlesSvc.create(userId, dto);
  }

  @Get()
  findAll(@CurrentUser() userId: string, @Query() query: ListBundlesQueryDto) {
    return this.bundlesSvc.findAll(userId, query.habitId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.bundlesSvc.findOne(userId, id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTemptationBundleDto,
    @CurrentUser() userId: string,
  ) {
    return this.bundlesSvc.update(userId, id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.bundlesSvc.remove(userId, id);
  }

  @Post(':id/use')
  use(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.bundlesSvc.use(userId, id);
  }
}
