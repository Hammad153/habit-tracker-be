import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../core/database/database.service';

export type SubscriptionTier = 'FREE' | 'BASIC' | 'PREMIUM';

export interface SubscriptionInfo {
  tier: SubscriptionTier;
  habitLimit: number; // -1 means unlimited
  currentHabitCount: number;
  canCreateHabit: boolean;
}

@Injectable()
export class SubscriptionService {
  constructor(private readonly databaseSvc: DatabaseService) {}

  // The app is free to use: every user gets unlimited habits and full access,
  // so they never have to subscribe before using the app effectively.
  private async buildInfo(
    userId: string,
    tier: SubscriptionTier,
  ): Promise<SubscriptionInfo> {
    let currentHabitCount = 0;
    if (userId) {
      currentHabitCount = await this.databaseSvc.habit.count({
        where: { userId, isArchived: false },
      });
    }

    return {
      tier,
      habitLimit: -1,
      currentHabitCount,
      canCreateHabit: true,
    };
  }

  get(userId: string): Promise<SubscriptionInfo> {
    return this.buildInfo(userId || 'default-user', 'FREE');
  }

  update(userId: string, tier: SubscriptionTier): Promise<SubscriptionInfo> {
    return this.buildInfo(userId || 'default-user', tier || 'FREE');
  }
}
