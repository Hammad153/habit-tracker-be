import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../core/database/database.service';

export interface CreateAuditLogParams {
  adminId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
}

export class AuditLogQueryDto {
  page?: number;
  limit?: number;
  action?: string;
  targetType?: string;
  adminId?: string;
  search?: string;
}

@Injectable()
export class AuditLogService {
  constructor(private readonly db: DatabaseService) {}

  async log(params: CreateAuditLogParams) {
    try {
      return await this.db.auditLog.create({
        data: {
          adminId: params.adminId,
          action: params.action,
          targetType: params.targetType,
          targetId: params.targetId,
          details: params.details ? (params.details as any) : undefined,
          ipAddress: params.ipAddress,
        },
      });
    } catch (err) {
      console.error('[AuditLogService] Failed to record audit log:', err);
    }
  }

  async getLogs(query: AuditLogQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.action) {
      where.action = query.action;
    }
    if (query.targetType) {
      where.targetType = query.targetType;
    }
    if (query.adminId) {
      where.adminId = query.adminId;
    }
    if (query.search) {
      where.OR = [
        { action: { contains: query.search, mode: 'insensitive' } },
        { targetType: { contains: query.search, mode: 'insensitive' } },
        { targetId: { contains: query.search, mode: 'insensitive' } },
        { admin: { email: { contains: query.search, mode: 'insensitive' } } },
        { admin: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.db.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          admin: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      }),
      this.db.auditLog.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
