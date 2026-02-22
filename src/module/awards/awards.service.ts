import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/core/database/database.service';
import { calculateStreaks } from 'src/core/utils/streak.utils';

@Injectable()
export class AwardsService {
  constructor(private databaseSvc: DatabaseService) {}

  public async findAll() {
    return this.databaseSvc.badge.findMany();
  }

  public async findUserBadges(userId: string) {
    return this.databaseSvc.userBadge.findMany({
      where: { userId },
      include: { badge: true },
    });
  }

  public async findOne(id: string) {
    return this.databaseSvc.badge.findUnique({
      where: { id },
    });
  }

  public async checkAndAwardBadges(userId: string) {
    const user = await this.databaseSvc.user.findUnique({
      where: { id: userId },
      include: {
        habits: {
          include: {
            completions: true,
          },
        },
        badges: true,
      },
    });

    if (!user) return;

    const allCompletions = user.habits.flatMap((h) => h.completions);
    const completedCount = allCompletions.filter((c) => c.status).length;
    const completionDates = allCompletions.map((c) => c.date);
    const { currentStreak } = calculateStreaks(completionDates);

    const potentialBadges: string[] = [];

    // Milestone: First Habit
    if (completedCount >= 1) potentialBadges.push('first-habit');

    // Streak: 3 Days
    if (currentStreak >= 3) potentialBadges.push('3-day-streak');

    // Streak: 7 Days
    if (currentStreak >= 7) potentialBadges.push('7-day-streak');

    // Milestone: Centurion
    if (completedCount >= 100) potentialBadges.push('centurion');

    for (const badgeId of potentialBadges) {
      const alreadyEarned = user.badges.some((ub) => ub.badgeId === badgeId);
      if (!alreadyEarned) {
        try {
          await this.databaseSvc.userBadge.create({
            data: {
              userId,
              badgeId,
            },
          });
        } catch (e) {
          // Ignore if badge doesn't exist in DB
        }
      }
    }
  }
}
