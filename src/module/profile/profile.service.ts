import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../core/database/database.service';
import * as bcrypt from 'bcryptjs';
import { SALT_ROUND } from '../../constants';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
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
    const { password, refreshToken, ...safe } = user;
    return safe;
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
