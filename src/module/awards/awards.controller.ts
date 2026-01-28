import { Controller, Get, Param, Query } from '@nestjs/common';
import { AwardsService } from './awards.service';

@Controller('awards')
export class AwardsController {
  constructor(private readonly awardsService: AwardsService) {}

  @Get()
  findAll() {
    return this.awardsService.findAll();
  }

  @Get('user')
  findUserBadges(@Query('userId') userId: string) {
    return this.awardsService.findUserBadges(userId || 'default-user');
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.awardsService.findOne(id);
  }
}
