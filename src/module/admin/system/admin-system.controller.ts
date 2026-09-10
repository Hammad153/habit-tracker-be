import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../core/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { AdminSystemService } from './admin-system.service';

@ApiTags('Admin System Settings')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/system')
export class AdminSystemController {
  constructor(private readonly adminSystemSvc: AdminSystemService) {}

  @Get('config')
  getSystemConfig() {
    return this.adminSystemSvc.getSystemConfig();
  }
}
