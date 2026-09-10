import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../../core/database/database.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { RewardItemType, RewardItemStatus } from '@prisma/client';

export class CreateShopItemDto {
  key!: string;
  name!: string;
  description?: string;
  cost!: number;
  type!: RewardItemType;
  status?: RewardItemStatus;
}

export class UpdateShopItemDto {
  name?: string;
  description?: string;
  cost?: number;
  type?: RewardItemType;
  status?: RewardItemStatus;
}

export class RedemptionsQueryDto {
  page?: number;
  limit?: number;
  search?: string;
}

@Injectable()
export class AdminShopService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogSvc: AuditLogService,
  ) {}

  async getItems() {
    const items = await this.db.rewardItem.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            redemptions: true,
          },
        },
      },
    });

    return items.map((item) => ({
      id: item.id,
      key: item.key,
      name: item.name,
      description: item.description,
      cost: item.cost,
      type: item.type,
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      redemptionsCount: item._count.redemptions,
      totalCoinsSpent: item.cost * item._count.redemptions,
    }));
  }

  async createItem(adminId: string, dto: CreateShopItemDto, ipAddress?: string) {
    const existing = await this.db.rewardItem.findUnique({
      where: { key: dto.key },
    });

    if (existing) {
      throw new BadRequestException(`Shop item with key "${dto.key}" already exists`);
    }

    const item = await this.db.rewardItem.create({
      data: {
        key: dto.key,
        name: dto.name,
        description: dto.description,
        cost: Number(dto.cost),
        type: dto.type,
        status: dto.status || RewardItemStatus.ACTIVE,
      },
    });

    await this.auditLogSvc.log({
      adminId,
      action: 'SHOP_ITEM_CREATE',
      targetType: 'REWARD_ITEM',
      targetId: item.id,
      details: {
        key: item.key,
        name: item.name,
        cost: item.cost,
        type: item.type,
        status: item.status,
      },
      ipAddress,
    });

    return item;
  }

  async updateItem(
    adminId: string,
    itemId: string,
    dto: UpdateShopItemDto,
    ipAddress?: string,
  ) {
    const existing = await this.db.rewardItem.findUnique({
      where: { id: itemId },
    });

    if (!existing) {
      throw new NotFoundException(`Shop item with ID ${itemId} not found`);
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.cost !== undefined) data.cost = Number(dto.cost);
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.status !== undefined) data.status = dto.status;

    const updated = await this.db.rewardItem.update({
      where: { id: itemId },
      data,
    });

    await this.auditLogSvc.log({
      adminId,
      action: 'SHOP_ITEM_UPDATE',
      targetType: 'REWARD_ITEM',
      targetId: itemId,
      details: {
        previous: {
          name: existing.name,
          cost: existing.cost,
          status: existing.status,
          type: existing.type,
        },
        updated: data,
      },
      ipAddress,
    });

    return updated;
  }

  async getRedemptions(query: RedemptionsQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.search) {
      where.OR = [
        { user: { name: { contains: query.search, mode: 'insensitive' } } },
        { user: { email: { contains: query.search, mode: 'insensitive' } } },
        { item: { name: { contains: query.search, mode: 'insensitive' } } },
        { item: { key: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.db.rewardRedemption.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          item: {
            select: {
              id: true,
              key: true,
              name: true,
              type: true,
            },
          },
        },
      }),
      this.db.rewardRedemption.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getEconomyStats() {
    const ledgerAggregates = await this.db.rewardLedger.findMany({
      select: { amount: true },
    });

    let totalCoinsEarned = 0;
    let totalCoinsSpent = 0;

    for (const entry of ledgerAggregates) {
      if (entry.amount > 0) {
        totalCoinsEarned += entry.amount;
      } else if (entry.amount < 0) {
        totalCoinsSpent += Math.abs(entry.amount);
      }
    }

    const netCirculation = totalCoinsEarned - totalCoinsSpent;

    const totalRedemptions = await this.db.rewardRedemption.count();

    const topItems = await this.db.rewardRedemption.groupBy({
      by: ['itemId'],
      _count: { _all: true },
      _sum: { cost: true },
      orderBy: { _count: { itemId: 'desc' } },
      take: 5,
    });

    const itemDetails = await Promise.all(
      topItems.map(async (ti) => {
        const item = await this.db.rewardItem.findUnique({
          where: { id: ti.itemId },
          select: { name: true, key: true, type: true },
        });
        return {
          itemId: ti.itemId,
          name: item?.name || 'Unknown',
          key: item?.key || '',
          type: item?.type || '',
          redemptionsCount: ti._count._all,
          totalCoinsSpent: ti._sum.cost || 0,
        };
      }),
    );

    return {
      totalCoinsEarned,
      totalCoinsSpent,
      netCirculation,
      totalRedemptions,
      topItems: itemDetails,
    };
  }
}
