import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../core/database/database.service';
import { calculateStreaks } from '../../core/utils/streak.utils';

const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100];

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
            completions: {
              where: { status: true },
              select: { date: true, createdAt: true },
            },
          },
        },
        badges: true,
      },
    });

    if (!user) return;

    const allCompletions = user.habits.flatMap((h) => h.completions);
    const completedCount = allCompletions.length;
    const completionDates = allCompletions.map((c) => c.date);
    const { currentStreak } = calculateStreaks(completionDates);

    const potentialBadges: string[] = [];

    // ── Milestone: First Step (>= 1 completion) ─────────────────────
    if (completedCount >= 1) potentialBadges.push('first-step');

    // ── Milestone: Early Bird (any completion before 8 AM) ──────────
    const hasEarlyCompletion = allCompletions.some((c) => {
      if (!c.createdAt) return false;
      const hour = new Date(c.createdAt).getUTCHours();
      return hour < 8;
    });
    if (hasEarlyCompletion) potentialBadges.push('early-bird');

    // ── Milestone: Perfect Week (7 consecutive 100% days) ──────────
    if (this.hasPerfectWeek(user.habits)) {
      potentialBadges.push('perfect-week');
    }

    // ── Milestone: Centurion (>= 100 total completions) ─────────────
    if (completedCount >= 100) potentialBadges.push('centurion');

    // ── Streak badges (one per milestone tier) ──────────────────────
    for (const days of STREAK_MILESTONES) {
      if (currentStreak >= days) {
        potentialBadges.push(`${days}-day-streak`);
      }
    }

    // ── Award any new badges ────────────────────────────────────────
    for (const badgeId of potentialBadges) {
      const alreadyEarned = user.badges.some((ub) => ub.badgeId === badgeId);
      if (!alreadyEarned) {
        try {
          await this.databaseSvc.userBadge.create({
            data: { userId, badgeId },
          });
        } catch {
          // Badge may not exist in DB yet — ignore gracefully.
        }
      }
    }
  }

  /**
   * Checks whether every active habit was completed every day for at least
   * one full 7-day window (rolling, not calendar-aligned).
   */
  private hasPerfectWeek(habits: any[]): boolean {
    if (habits.length === 0) return false;

    const today = new Date();
    // Check each rolling7-day window in the last 30 days.
    for (let offset = 0; offset <= 23; offset++) {
      const windowEnd = new Date(today);
      windowEnd.setDate(windowEnd.getDate() - offset);
      const windowStart = new Date(windowEnd);
      windowStart.setDate(windowStart.getDate() - 6);

      const startKey = windowStart.toISOString().slice(0, 10);
      const endKey = windowEnd.toISOString().slice(0, 10);

      let allComplete = true;
      for (const habit of habits) {
        const createdKey = new Date(habit.createdAt).toISOString().slice(0, 10);
        // Only check habits that existed during this window.
        if (createdKey > endKey) continue;

        // Check every day in the window.
        for (let d = 0; d < 7; d++) {
          const day = new Date(windowStart);
          day.setDate(day.getDate() + d);
          const dayKey = day.toISOString().slice(0, 10);
          if (dayKey < startKey || dayKey > endKey) continue;
          // Habit must have existed on this day.
          if (dayKey < createdKey) continue;

          const completed = habit.completions.some(
            (c: any) => c.date === dayKey,
          );
          if (!completed) {
            allComplete = false;
            break;
          }
        }
        if (!allComplete) break;
      }
      if (allComplete) return true;
    }
    return false;
  }
}
