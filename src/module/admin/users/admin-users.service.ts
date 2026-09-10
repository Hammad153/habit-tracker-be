import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../../core/database/database.service';
import { AuditLogService } from '../audit-log/audit-log.service';

export class AdminUsersQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  role?: string;
  isSuspended?: boolean | string;
}

export class UpdateUserStatusDto {
  isSuspended!: boolean;
  reason?: string;
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogSvc: AuditLogService,
  ) {}

  async getUsers(query: AdminUsersQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.role) {
      where.role = query.role;
    }

    if (query.isSuspended !== undefined && query.isSuspended !== '') {
      where.isSuspended = String(query.isSuspended) === 'true';
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      this.db.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isSuspended: true,
          coins: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              habits: true,
              rewardRedemptions: true,
            },
          },
          subscription: {
            select: {
              status: true,
              planId: true,
              currentPeriodEnd: true,
            },
          },
        },
      }),
      this.db.user.count({ where }),
    ]);

    const formattedUsers = users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      isSuspended: u.isSuspended,
      coins: u.coins,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      habitsCount: u._count.habits,
      redemptionsCount: u._count.rewardRedemptions,
      subscription: u.subscription,
    }));

    return {
      items: formattedUsers,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getUser360(userId: string) {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isSuspended: true,
        coins: true,
        level: true,
        xp: true,
        longestStreak: true,
        totalHabits: true,
        completionRate: true,
        createdAt: true,
        updatedAt: true,
        subscription: true,
        habits: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            title: true,
            category: true,
            isArchived: true,
            createdAt: true,
            _count: {
              select: {
                completions: true,
              },
            },
          },
        },
        rewardRedemptions: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            item: {
              select: {
                name: true,
                type: true,
                cost: true,
              },
            },
          },
        },
        rewardLedger: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const totalCoinsEarned = user.rewardLedger
      .filter((entry) => entry.amount > 0)
      .reduce((sum, entry) => sum + entry.amount, 0);

    const totalCoinsSpent = user.rewardLedger
      .filter((entry) => entry.amount < 0)
      .reduce((sum, entry) => sum + Math.abs(entry.amount), 0);

    const auditHistory = await this.db.auditLog.findMany({
      where: {
        targetType: 'USER',
        targetId: userId,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        admin: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return {
      profile: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isSuspended: user.isSuspended,
        coins: user.coins,
        level: user.level,
        xp: user.xp,
        longestStreak: user.longestStreak,
        totalHabits: user.totalHabits,
        completionRate: user.completionRate,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      economy: {
        currentCoins: user.coins,
        totalEarned: totalCoinsEarned,
        totalSpent: totalCoinsSpent,
        ledger: user.rewardLedger,
        redemptions: user.rewardRedemptions,
      },
      habits: user.habits,
      subscription: user.subscription,
      auditHistory,
    };
  }

  async setUserStatus(
    adminId: string,
    userId: string,
    dto: UpdateUserStatusDto,
    ipAddress?: string,
  ) {
    if (adminId === userId && dto.isSuspended) {
      throw new BadRequestException('You cannot suspend your own admin account');
    }

    const existing = await this.db.user.findUnique({
      where: { id: userId },
    });

    if (!existing) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const updatedUser = await this.db.user.update({
      where: { id: userId },
      data: {
        isSuspended: dto.isSuspended,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isSuspended: true,
        updatedAt: true,
      },
    });

    await this.auditLogSvc.log({
      adminId,
      action: dto.isSuspended ? 'USER_SUSPEND' : 'USER_REACTIVATE',
      targetType: 'USER',
      targetId: userId,
      details: {
        email: existing.email,
        reason: dto.reason || (dto.isSuspended ? 'Suspended by admin' : 'Reactivated by admin'),
        previousStatus: existing.isSuspended,
        newStatus: dto.isSuspended,
      },
      ipAddress,
    });

    return updatedUser;
  }
}
