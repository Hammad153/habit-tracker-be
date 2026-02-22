import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../core/database/database.service';
import {
  calculateStreaks,
  calculatePerfectDays,
} from '../../core/utils/streak.utils';
import { calculateNeededXp } from '../../core/utils/progression.utils';

@Injectable()
export class ProfileService {
  constructor(private databaseSvc: DatabaseService) {}

  public async getProfile(userId: string) {
    const user = await this.databaseSvc.user.findUnique({
      where: { id: userId },
      include: {
        habits: {
          include: {
            completions: true,
          },
        },
      },
    });

    if (!user) {
      const newUser = await this.databaseSvc.user.create({
        data: {
          id: userId,
          name: 'Hammad Ismail',
          email: 'hammadismail2005@gmail.com',
          password: 'Welcome123',
        },
      });
      return {
        ...newUser,
        totalHabits: 0,
        longestStreak: 0,
        completionRate: 0,
        perfectDays: 0,
      };
    }

    const totalHabits = user.habits.length;

    // Calculate Streaks (User-wide)
    const allCompletions = user.habits.flatMap((h) => h.completions);
    const completionDates = allCompletions.map((c) => c.date);
    const { currentStreak, longestStreak } = calculateStreaks(completionDates);

    // Calculate Perfect Days
    const habitCompletionsList = user.habits.map((h) => h.completions);
    const perfectDays = calculatePerfectDays(habitCompletionsList);

    // Calculate Completion Rate
    let completionRate = 0;
    if (totalHabits > 0) {
      const startDate = user.createdAt;
      const today = new Date();
      const diffTime = Math.abs(today.getTime() - startDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;

      completionRate =
        allCompletions.filter((c) => c.status).length /
        (totalHabits * diffDays);
    }

    return {
      ...user,
      totalHabits,
      currentStreak,
      longestStreak,
      perfectDays,
      completionRate: Math.min(completionRate, 1),
      neededXp: calculateNeededXp(user.level),
    };
  }

  public async updateProfile(userId: string, data: any) {
    return this.databaseSvc.user.update({
      where: { id: userId },
      data,
    });
  }

  public async addExperience(userId: string, amount: number) {
    const user = await this.databaseSvc.user.findUnique({
      where: { id: userId },
    });

    if (!user) return;

    let newXp = user.xp + amount;
    if (newXp < 0) newXp = 0;

    let newLevel = user.level;
    let neededXp = calculateNeededXp(newLevel);

    while (newXp >= neededXp) {
      newXp -= neededXp;
      newLevel++;
      neededXp = calculateNeededXp(newLevel);
    }

    return this.databaseSvc.user.update({
      where: { id: userId },
      data: {
        xp: newXp,
        level: newLevel,
      },
    });
  }
}
