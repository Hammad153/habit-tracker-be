import { Controller, Delete, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CurrentUser } from '../../core/decorators/current-user.decorator';
import { BypassSubscriptionGate } from '../subscription/decorators/bypass-subscription-gate.decorator';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
@BypassSubscriptionGate()
export class UsersController {
  constructor(private readonly usersSvc: UsersService) {}

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Permanently delete the authenticated user and all their data',
  })
  async deleteMe(@CurrentUser() userId: string): Promise<void> {
    await this.usersSvc.deleteAccount(userId);
  }
}
