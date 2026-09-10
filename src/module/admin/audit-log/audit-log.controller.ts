import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../core/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { AuditLogService, AuditLogQueryDto } from './audit-log.service';

@ApiTags('Admin Audit Logs')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/audit-logs')
export class AuditLogController {
  constructor(private readonly auditLogSvc: AuditLogService) {}

  @Get()
  getLogs(@Query() query: AuditLogQueryDto) {
    return this.auditLogSvc.getLogs(query);
  }
}
