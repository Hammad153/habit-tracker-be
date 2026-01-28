import { Controller, Get, Patch, Body, Param, Query } from '@nestjs/common';
import { ProfileService } from './profile.service';

@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  getProfile(@Query('userId') userId: string) {
    return this.profileService.getProfile(userId || 'default-user');
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateProfileDto: any) {
    return this.profileService.updateProfile(id, updateProfileDto);
  }
}
