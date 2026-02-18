import { Controller, Get, Param, Query } from '@nestjs/common';
import { AwardsService } from './awards.service';
import {
  FindAllAwardsDocs,
  FindOneAwardDocs,
  FindUserBadgesDocs,
} from './award.swagger';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Awards')
@Controller('awards')
export class AwardsController {
  constructor(private readonly awardsService: AwardsService) {}

  @Get()
  @FindAllAwardsDocs()
  findAll() {
    return this.awardsService.findAll();
  }

  @Get('user')
  @FindUserBadgesDocs()
  findUserBadges(@Query('userId') userId: string) {
    return this.awardsService.findUserBadges(userId || 'default-user');
  }

  @Get(':id')
  @FindOneAwardDocs()
  findOne(@Param('id') id: string) {
    return this.awardsService.findOne(id);
  }
}
