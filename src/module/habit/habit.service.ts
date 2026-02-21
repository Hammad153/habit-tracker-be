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
  ): Promise<Completion> {
    const existing = await this.databaseSvc.completion.findUnique({
      where: {
        habitId_date: { habitId, date },
      },
    });

    if (existing) {
      return this.databaseSvc.completion.delete({
        where: { id: existing.id },
      });
    }

    try {
      return await this.databaseSvc.completion.create({
        data: {
          habitId,
          date,
          status: true,
        },
      });
    } catch (error) {
      if (error.code === 'P2002') {
        return this.databaseSvc.completion.findUniqueOrThrow({
          where: {
            habitId_date: { habitId, date },
          },
        });
      }
      throw error;
    }
  }
}
