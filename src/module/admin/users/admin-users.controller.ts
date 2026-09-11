import {
  Controller,
  Get,
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
  AdminUsersService,
  AdminUsersQueryDto,
  UpdateUserStatusDto,
  UpdateUserSubscriptionAccessDto,
} from './admin-users.service';

@ApiTags('Admin User Management')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly adminUsersSvc: AdminUsersService) {}

  @Get()
  getUsers(@Query() query: AdminUsersQueryDto) {
    return this.adminUsersSvc.getUsers(query);
  }

  @Get(':id')
  getUser360(@Param('id') id: string) {
    return this.adminUsersSvc.getUser360(id);
  }

  @Patch(':id/status')
  setUserStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    const adminId = req.user.sub;
    const ipAddress = req.ip || req.headers['x-forwarded-for'];
    return this.adminUsersSvc.setUserStatus(adminId, id, dto, ipAddress);
  }

  @Patch(':id/subscription-access')
  setSubscriptionAccess(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateUserSubscriptionAccessDto,
  ) {
    return this.adminUsersSvc.setSubscriptionAccess(
      req.user.sub,
      id,
      dto,
      req.ip || req.headers['x-forwarded-for'],
    );
  }
}
