import {
  Body,
  Get,
  Post,
  Controller,
  HttpCode,
  HttpStatus,
  UseGuards,
  Request,
  Req,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from './auth.guard';
import { ApiProfileDocs, ApiLoginDocs, ApiSignUpDocs } from './auth.swagger';
import { Public } from 'src/core/decorators/public.decorator';

@ApiTags('Auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  @ApiLoginDocs()
  signIn(@Body() signInDto: any) {
    return this.authService.signIn(signInDto.email, signInDto.password);
  }

  @Public()
  @Post('signup')
  @ApiSignUpDocs()
  signUp(@Body() signUpDto: any) {
    return this.authService.signUp(signUpDto);
  }

  @UseGuards(AuthGuard)
  @Get('profile')
  @ApiProfileDocs()
  getProfile(@Request() req: any) {
    return req.user;
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  async logout(@Req() req: any) {
    await this.authService.logout(req.user.sub);
    return { message: 'Logged out successfully' };
  }

  @Public()
  @Post('refresh')
  async refresh(@Body('refresh_token') token: string) {
    return this.authService.refreshToken(token);
  }
}
