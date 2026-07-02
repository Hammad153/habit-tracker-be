import { Controller, Get, Patch, Body, Post, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ProfileService } from './profile.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CurrentUser } from '../../core/decorators/current-user.decorator';

@ApiTags('Profile')
@ApiBearerAuth()
@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  getProfile(@CurrentUser() userId: string) {
    return this.profileService.getProfile(userId);
  }

  // The `:id` segment is retained for client compatibility but ignored — the
  // profile updated is always the authenticated caller's own (prevents IDOR).
  @Patch(':id')
  update(
    @Param('id') _id: string,
    @Body() updateProfileDto: UpdateProfileDto,
    @CurrentUser() userId: string,
  ) {
    return this.profileService.updateProfile(userId, updateProfileDto);
  }

  @Post('change-password')
  changePassword(
    @CurrentUser() userId: string,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    return this.profileService.changePassword(userId, changePasswordDto);
  }
}
