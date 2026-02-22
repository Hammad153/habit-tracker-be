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
    return this.databaseSvc.habit.findMany({
      where: { userId },
      include: { completions: true },
    });
  }

  public async findOne(id: string): Promise<Habit> {
    const habit = await this.databaseSvc.habit.findUnique({
      where: { id },
      include: { completions: true },
    });
    if (!habit) throw new NotFoundException(`Habit with ID ${id} not found`);
    return habit;
  }

  public async createHabit(userId: string, data: any): Promise<Habit> {
    return this.databaseSvc.habit.create({
      data: {
        ...data,
        userId,
      },
    });
  }

  public async updateHabit(id: string, data: any): Promise<Habit> {
    return this.databaseSvc.habit.update({
      where: { id },
      data,
    });
  }

  public async deleteHabit(id: string): Promise<Habit> {
    return this.databaseSvc.habit.delete({
      where: { id },
    });
  }

  public async toggleCompletion(
    habitId: string,
    date: string,
    value?: number,
  ): Promise<Completion> {
    const habit = await this.findOne(habitId);
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
    } catch (error) {
      if (error.code === 'P2002') {
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
