import { Injectable, NotFoundException } from '@nestjs/common';
import { Habit, Completion } from '@prisma/client';
import { DatabaseService } from '../../core/database/database.service';
import { ProfileService } from '../profile/profile.service';
import { AwardsService } from '../awards/awards.service';
import { XP_PER_COMPLETION } from '../../core/utils/progression.utils';

@Injectable()
export class HabitService {
  constructor(
    private databaseSvc: DatabaseService,
    private profileSvc: ProfileService,
    private awardsSvc: AwardsService,
  ) {}

  public async findAll(userId: string): Promise<Habit[]> {
    // Clean up expired habits before returning
    await this.cleanupExpiredHabits();

    return this.databaseSvc.habit.findMany({
      where: { userId },
      include: { completions: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  public async findOne(id: string, userId: string): Promise<Habit> {
    const habit = await this.databaseSvc.habit.findUnique({
      where: { id },
      include: { completions: true },
    });
    if (!habit) throw new NotFoundException(`Habit with ID ${id} not found`);
    if (habit.userId !== userId) {
      // Don't reveal existence of habits owned by other users.
      throw new NotFoundException(`Habit with ID ${id} not found`);
    }
    return habit;
  }

  public async createHabit(userId: string, data: any): Promise<Habit> {
    // userId always comes from the authenticated token; never trust a userId
    // supplied in the request body.
    const { userId: _ignored, ...habitData } = data ?? {};

    // Convert date strings to Date objects if provided
    const processedData = {
      ...habitData,
      startDate: habitData.startDate
        ? new Date(habitData.startDate)
        : undefined,
      endDate: habitData.endDate ? new Date(habitData.endDate) : undefined,
    };

    return this.databaseSvc.habit.create({
      data: {
        ...processedData,
        userId,
      },
    });
  }

  public async updateHabit(
    id: string,
    userId: string,
    data: any,
  ): Promise<Habit> {
    await this.findOne(id, userId); // enforces ownership
    const { userId: _ignored, ...habitData } = data ?? {};

    // Convert date strings to Date objects if provided
    const processedData = {
      ...habitData,
      startDate: habitData.startDate
        ? new Date(habitData.startDate)
        : undefined,
      endDate: habitData.endDate ? new Date(habitData.endDate) : undefined,
    };

    return this.databaseSvc.habit.update({
      where: { id },
      data: processedData,
    });
  }

  public async deleteHabit(id: string, userId: string): Promise<Habit> {
    await this.findOne(id, userId); // enforces ownership
    return this.databaseSvc.habit.delete({
      where: { id },
    });
  }

  /**
   * Cleans up habits that have passed their endDate.
   * This is called automatically when fetching habits, but can also be called manually.
   */
  public async cleanupExpiredHabits(): Promise<number> {
    const now = new Date();

    // Find all habits with endDate that has passed
    const expiredHabits = await this.databaseSvc.habit.findMany({
      where: {
        endDate: {
          not: null,
          lt: now,
        },
        isArchived: false,
      },
      select: { id: true },
    });

    if (expiredHabits.length === 0) {
      return 0;
    }

    // Delete expired habits (cascades to completions and reminders)
    const result = await this.databaseSvc.habit.deleteMany({
      where: {
        id: {
          in: expiredHabits.map((h) => h.id),
        },
      },
    });

    return result.count;
  }

  public async toggleCompletion(
    habitId: string,
    userId: string,
    date: string,
    value?: number,
  ): Promise<Completion> {
    const habit = await this.findOne(habitId, userId);
    const existing = await this.databaseSvc.completion.findUnique({
      where: {
        habitId_date: { habitId, date },
      },
    });

    const completionValue = value ?? habit.goal;
    const isCompleted = completionValue >= habit.goal;

    if (existing) {
      if (value === undefined) {
        const wasCompleted = existing.status;
        const result = await this.databaseSvc.completion.delete({
          where: { id: existing.id },
        });
        if (wasCompleted) {
          await this.profileSvc.addExperience(habit.userId, -XP_PER_COMPLETION);
        }
        return result;
      }
      // Update existing completion with new value
      return this.databaseSvc.completion.update({
        where: { id: existing.id },
        data: {
          value: completionValue,
          status: isCompleted,
        },
      });
    }

    try {
      const completion = await this.databaseSvc.completion.create({
        data: {
          habitId,
          date,
          status: isCompleted,
          value: completionValue,
        },
      });

      if (isCompleted) {
        await this.profileSvc.addExperience(habit.userId, XP_PER_COMPLETION);
        await this.awardsSvc.checkAndAwardBadges(habit.userId);
      }

      return completion;
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('P2002')) {
        const existingCompletion = await this.databaseSvc.completion.findUnique(
          {
            where: {
              habitId_date: { habitId, date },
            },
          },
        );

        const wasCompleted = existingCompletion?.status || false;

        const updated = await this.databaseSvc.completion.update({
          where: {
            habitId_date: { habitId, date },
          },
          data: {
            value: completionValue,
            status: isCompleted,
          },
        });

        if (isCompleted && !wasCompleted) {
          await this.profileSvc.addExperience(habit.userId, XP_PER_COMPLETION);
          await this.awardsSvc.checkAndAwardBadges(habit.userId);
        } else if (!isCompleted && wasCompleted) {
          await this.profileSvc.addExperience(habit.userId, -XP_PER_COMPLETION);
        }

        return updated;
      }
      throw error;
    }
  }
}
