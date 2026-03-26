import { Injectable, NotFoundException } from '@nestjs/common';
import { SubscriptionTier } from '@prisma/client';
import { DatabaseService } from '../../core/database/database.service';

export const TIER_HABIT_LIMITS: Record<SubscriptionTier, number> = {
  FREE: 5,
  BASIC: Infinity,
  PREMIUM: Infinity,
};

@Injectable()
export class SubscriptionService {
  constructor(private databaseSvc: DatabaseService) {}

  public async getUserTier(userId: string): Promise<{
    tier: SubscriptionTier;
    habitLimit: number;
    currentHabitCount: number;
    canCreateHabit: boolean;
  }> {
    const user = await this.databaseSvc.user.findUnique({
      where: { id: userId },
      select: { subscriptionTier: true },
    });

    if (!user) throw new NotFoundException(`User ${userId} not found`);

    const habitCount = await this.databaseSvc.habit.count({
      where: { userId, isArchived: false },
    });

    const limit = TIER_HABIT_LIMITS[user.subscriptionTier];

    return {
      tier: user.subscriptionTier,
      habitLimit: limit === Infinity ? -1 : limit, // -1 means unlimited
      currentHabitCount: habitCount,
      canCreateHabit: habitCount < limit,
    };
  }

  public async updateTier(
    userId: string,
    tier: SubscriptionTier,
  ): Promise<{ tier: SubscriptionTier }> {
    const user = await this.databaseSvc.user.update({
      where: { id: userId },
      data: { subscriptionTier: tier },
      select: { subscriptionTier: true },
    });

    return { tier: user.subscriptionTier };
  }
}
