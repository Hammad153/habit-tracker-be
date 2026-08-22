import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RewardsService } from './rewards.service';
import { CurrentUser } from '../../core/decorators/current-user.decorator';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

class ListRewardsQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  take?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}

@ApiTags('Rewards')
@ApiBearerAuth()
@Controller('reward')
export class RewardsController {
  constructor(private readonly rewardsSvc: RewardsService) {}

  @Get('balance')
  @ApiOkResponse({
    description:
      'Virtual coin balance. Ledger-derived balance plus the cached user balance with a consistency flag.',
    schema: {
      example: { balance: 35, cachedBalance: 35, consistent: true },
    },
  })
  getBalance(@CurrentUser() userId: string) {
    return this.rewardsSvc.getBalance(userId);
  }

  @Get('transactions')
  list(@CurrentUser() userId: string, @Query() query: ListRewardsQueryDto) {
    return this.rewardsSvc.listTransactions(userId, query);
  }
}
