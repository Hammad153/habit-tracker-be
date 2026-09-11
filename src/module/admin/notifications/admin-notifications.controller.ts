import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../core/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { AdminNotificationsService } from './admin-notifications.service';

@ApiTags('Admin Notifications')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/notifications')
export class AdminNotificationsController {
  constructor(private readonly notifications: AdminNotificationsService) {}

  @Get('overview')
  getOverview() {
    return this.notifications.getOverview();
  }
}
