import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../core/decorators/roles.decorator';
import { Role } from '@prisma/client';
import {
  AdminShopService,
  CreateShopItemDto,
  UpdateShopItemDto,
  RedemptionsQueryDto,
} from './admin-shop.service';

@ApiTags('Admin Shop & Economy')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminShopController {
  constructor(private readonly adminShopSvc: AdminShopService) {}

  @Get('shop/items')
  getItems() {
    return this.adminShopSvc.getItems();
  }

  @Post('shop/items')
  createItem(@Req() req: any, @Body() dto: CreateShopItemDto) {
    const adminId = req.user.sub;
    const ipAddress = req.ip || req.headers['x-forwarded-for'];
    return this.adminShopSvc.createItem(adminId, dto, ipAddress);
  }

  @Patch('shop/items/:id')
  updateItem(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateShopItemDto,
  ) {
    const adminId = req.user.sub;
    const ipAddress = req.ip || req.headers['x-forwarded-for'];
    return this.adminShopSvc.updateItem(adminId, id, dto, ipAddress);
  }

  @Get('shop/redemptions')
  getRedemptions(@Query() query: RedemptionsQueryDto) {
    return this.adminShopSvc.getRedemptions(query);
  }

  @Get('economy/stats')
  getEconomyStats() {
    return this.adminShopSvc.getEconomyStats();
  }
}
