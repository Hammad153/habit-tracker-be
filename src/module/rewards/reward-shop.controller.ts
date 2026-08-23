import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RewardShopService } from './reward-shop.service';
import { CurrentUser } from '../../core/decorators/current-user.decorator';

@ApiTags('Reward Shop')
@ApiBearerAuth()
@Controller('reward/shop')
export class RewardShopController {
  constructor(private readonly shopSvc: RewardShopService) {}

  @Get()
  listItems(@CurrentUser() userId: string) {
    return this.shopSvc.listItems(userId);
  }

  @Post(':id/redeem')
  redeem(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.shopSvc.redeemItem(userId, id);
  }
}
