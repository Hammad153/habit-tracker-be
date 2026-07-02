import { Controller, Get, Param } from '@nestjs/common';
import { AwardsService } from './awards.service';
import {
  FindAllAwardsDocs,
  FindOneAwardDocs,
  FindUserBadgesDocs,
} from './award.swagger';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../core/decorators/current-user.decorator';

@ApiTags('Awards')
@ApiBearerAuth()
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
  findUserBadges(@CurrentUser() userId: string) {
    return this.awardsService.findUserBadges(userId);
  }

  @Get(':id')
  @FindOneAwardDocs()
  findOne(@Param('id') id: string) {
    return this.awardsService.findOne(id);
  }
}
