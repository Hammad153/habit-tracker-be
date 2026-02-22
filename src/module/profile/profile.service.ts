import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/core/database/database.service';

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
      };
    }

    const totalHabits = user.habits.length;

    // Calculate Longest Streak (User-wide)
    const allCompletions = user.habits.flatMap((h) => h.completions);
    const uniqueDates = [...new Set(allCompletions.map((c) => c.date))].sort();

    let longestStreak = 0;
    let currentStreak = 0;
    let prevDate: Date | null = null;

    for (const dateStr of uniqueDates) {
      const currentDate = new Date(dateStr);
      if (prevDate) {
        const diffDays = Math.floor(
          (currentDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (diffDays === 1) {
          currentStreak++;
        } else {
          currentStreak = 1;
        }
      } else {
        currentStreak = 1;
      }
      longestStreak = Math.max(longestStreak, currentStreak);
      prevDate = currentDate;
    }

    // Calculate Completion Rate
    let completionRate = 0;
    if (totalHabits > 0) {
      const startDate = user.createdAt;
      const today = new Date();
      const diffTime = Math.abs(today.getTime() - startDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;

      completionRate = allCompletions.length / (totalHabits * diffDays);
    }

    return {
      ...user,
      totalHabits,
      longestStreak,
      completionRate: Math.min(completionRate, 1),
    };
  }

  public async updateProfile(userId: string, data: any) {
    return this.databaseSvc.user.update({
      where: { id: userId },
      data,
    });
  }
}
