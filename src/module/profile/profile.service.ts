import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { INTERACTIVE_TX_OPTIONS } from '../../core/database/transaction-options';
import { DatabaseService } from '../../core/database/database.service';
import { UpdateCoachPreferencesDto } from './dto/coach-preferences.dto';
import * as bcrypt from 'bcryptjs';
import { SALT_ROUND } from '../../constants';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  calculateStreaks,
  calculatePerfectDays,
} from '../../core/utils/streak.utils';
import { calculateNeededXp } from '../../core/utils/progression.utils';

type Tx = Prisma.TransactionClient;

@Injectable()
export class ProfileService {
  constructor(private databaseSvc: DatabaseService) {}

  /** Phase 3.4 — persistent AI/coach preferences. */
  public async getCoachPreferences(userId: string) {
    const user = await this.databaseSvc.user.findUnique({
      where: { id: userId },
      select: {
        coachEnabled: true,
        aiCoachEnabled: true,
        coachTone: true,
        coachFrequency: true,
        weeklyReviewEnabled: true,
      },
    });
    return (
      user ?? {
        coachEnabled: true,
        aiCoachEnabled: true,
        coachTone: 'BALANCED',
        coachFrequency: 'STANDARD',
        weeklyReviewEnabled: true,
      }
    );
  }

  public async updateCoachPreferences(
    userId: string,
    dto: UpdateCoachPreferencesDto,
  ) {
    await this.databaseSvc.user.update({
      where: { id: userId },
      data: {
        coachEnabled: dto.coachEnabled,
        aiCoachEnabled: dto.aiCoachEnabled,
        coachTone: dto.coachTone,
        coachFrequency: dto.coachFrequency,
        weeklyReviewEnabled: dto.weeklyReviewEnabled,
      },
    });
    return this.getCoachPreferences(userId);
  }

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
      throw new NotFoundException('User not found');
    }

    const totalHabits = user.habits.length;

    // Calculate Streaks (User-wide)
    const allCompletions = user.habits.flatMap((h) => h.completions);
    const completionDates = allCompletions.map((c) => c.date);
    const { currentStreak, longestStreak } = calculateStreaks(completionDates);

    // Calculate Perfect Days
    const perfectDays = calculatePerfectDays(user.habits);

    // Calculate Completion Rate
    let completionRate = 0;
    if (totalHabits > 0) {
      const today = new Date();
      let totalEligibleHabitDays = 0;
      for (const h of user.habits) {
        const hCreatedAt = h.createdAt || user.createdAt;
        const diffTime = Math.abs(today.getTime() - hCreatedAt.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;
        totalEligibleHabitDays += diffDays;
      }
      completionRate = totalEligibleHabitDays
        ? allCompletions.filter((c) => c.status).length / totalEligibleHabitDays
        : 0;
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

  public async updateProfile(userId: string, data: UpdateProfileDto) {
    const user = await this.databaseSvc.user.update({
      where: { id: userId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.avatar !== undefined ? { avatar: data.avatar } : {}),
      },
    });
    const safe = { ...user } as Partial<typeof user>;
    delete safe.password;
    delete safe.refreshToken;
    return safe;
  }

  public async addExperience(userId: string, amount: number) {
    return this.databaseSvc.$transaction((tx) =>
      this.addExperienceTx(tx, userId, amount),
      INTERACTIVE_TX_OPTIONS,
    );
  }

  /**
   * XP mutation that participates in an existing transaction so completion +
   * rewards stay atomic. Preserves the historical semantics: user.xp holds
   * experience within the current level, overflowing into higher levels.
   */
  public async addExperienceTx(tx: Tx, userId: string, amount: number) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { xp: true, level: true },
    });

    if (!user) return null;

    let newXp = Math.max(user.xp + amount, 0);
    let newLevel = user.level;
    let neededXp = calculateNeededXp(newLevel);

    while (newXp >= neededXp) {
      newXp -= neededXp;
      newLevel++;
      neededXp = calculateNeededXp(newLevel);
    }

    return tx.user.update({
      where: { id: userId },
      data: {
        xp: newXp,
        level: newLevel,
      },
      select: { id: true, xp: true, level: true },
    });
  }

  public async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.databaseSvc.user.findUnique({
      where: { id: userId },
    });

    if (!user) throw new UnauthorizedException('User not found');

    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const isMatch = await bcrypt.compare(dto.oldPassword, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid current password');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, SALT_ROUND);

    return this.databaseSvc.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });
  }
}
