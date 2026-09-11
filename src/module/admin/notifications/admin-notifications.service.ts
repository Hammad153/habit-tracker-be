import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../core/database/database.service';

@Injectable()
export class AdminNotificationsService {
  constructor(private readonly db: DatabaseService) {}

  async getOverview() {
    const [total, reengagement, byType, recent] = await Promise.all([
      this.db.notificationDelivery.count(),
      this.db.notificationDelivery.count({ where: { type: 'REENGAGEMENT' } }),
      this.db.notificationDelivery.groupBy({
        by: ['type', 'status'],
        _count: { _all: true },
      }),
      this.db.notificationDelivery.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          type: true,
          priority: true,
          status: true,
          dayKey: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
        },
      }),
    ]);

    return {
      total,
      reengagement,
      byType: byType.map((row) => ({
        type: row.type,
        status: row.status,
        count: row._count._all,
      })),
      recent,
    };
  }
}
