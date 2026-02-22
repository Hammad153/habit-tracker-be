import { Injectable, NotFoundException } from '@nestjs/common';
import { Habit, Completion } from '@prisma/client';
import { DatabaseService } from 'src/core/database/database.service';

@Injectable()
export class HabitService {
  constructor(private databaseSvc: DatabaseService) {}

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
        // Simple toggle off if no value provided (traditional behavior)
        return this.databaseSvc.completion.delete({
          where: { id: existing.id },
        });
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
      return await this.databaseSvc.completion.create({
        data: {
          habitId,
          date,
          status: isCompleted,
          value: completionValue,
        },
      });
    } catch (error) {
      if (error.code === 'P2002') {
        return this.databaseSvc.completion.update({
          where: {
            habitId_date: { habitId, date },
          },
          data: {
            value: completionValue,
            status: isCompleted,
          },
        });
      }
      throw error;
    }
  }
}
