import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Habit, Completion } from '@prisma/client';

@Injectable()
export class HabitService {
  constructor(private prisma: PrismaService) {}

  async findAll(userId: string): Promise<Habit[]> {
    return this.prisma.habit.findMany({
      where: { userId },
      include: { completions: true },
    });
  }

  async findOne(id: string): Promise<Habit> {
    const habit = await this.prisma.habit.findUnique({
      where: { id },
      include: { completions: true },
    });
    if (!habit) throw new NotFoundException(`Habit with ID ${id} not found`);
    return habit;
  }

  async createHabit(userId: string, data: any): Promise<Habit> {
    return this.prisma.habit.create({
      data: {
        ...data,
        userId,
      },
    });
  }

  async updateHabit(id: string, data: any): Promise<Habit> {
    return this.prisma.habit.update({
      where: { id },
      data,
    });
  }

  async deleteHabit(id: string): Promise<Habit> {
    return this.prisma.habit.delete({
      where: { id },
    });
  }

  async toggleCompletion(habitId: string, date: string): Promise<Completion> {
    const existing = await this.prisma.completion.findUnique({
      where: {
        habitId_date: { habitId, date },
      },
    });

    if (existing) {
      return this.prisma.completion.delete({
        where: { id: existing.id },
      });
    }

    return this.prisma.completion.create({
      data: {
        habitId,
        date,
        status: true,
      },
    });
  }
}
