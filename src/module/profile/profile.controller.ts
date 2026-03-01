import {
  Controller,
  Get,
  Patch,
  Body,
  Post,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ProfileService } from './profile.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuthGuard } from '../auth/auth.guard';

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

  @UseGuards(AuthGuard)
  @Post('change-password')
  changePassword(
    @Request() req: any,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    return this.profileService.changePassword(req.user.sub, changePasswordDto);
  }
}
