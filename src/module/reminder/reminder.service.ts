import { Injectable, NotFoundException } from '@nestjs/common';
import { Reminder } from '@prisma/client';
import { DatabaseService } from '../../core/database/database.service';
import { CreateReminderDto, UpdateReminderDto } from './dto/reminder.dto';

@Injectable()
export class ReminderService {
  constructor(private databaseSvc: DatabaseService) {}

  public async findAll(userId: string): Promise<Reminder[]> {
    return this.databaseSvc.reminder.findMany({
      where: { userId },
      include: { habit: { select: { title: true, icon: true, iconColor: true } } },
      orderBy: { time: 'asc' },
    });
  }

  public async findByHabit(userId: string, habitId: string): Promise<Reminder | null> {
    return this.databaseSvc.reminder.findFirst({
      where: { habitId, userId },
    });
  }

  public async create(userId: string, data: CreateReminderDto): Promise<Reminder> {
    const habit = await this.databaseSvc.habit.findFirst({
      where: { id: data.habitId, userId },
    });
    if (!habit)
      throw new NotFoundException(`Habit with ID ${data.habitId} not found`);

    return this.databaseSvc.reminder.upsert({
      where: { habitId: data.habitId },
      update: {
        time: data.time,
        days: data.days,
        enabled: data.enabled ?? true,
      },
      create: {
        userId,
        habitId: data.habitId,
        time: data.time,
        days: data.days,
        enabled: data.enabled ?? true,
      },
    });
  }

  public async update(userId: string, id: string, data: UpdateReminderDto): Promise<Reminder> {
    const reminder = await this.databaseSvc.reminder.findUnique({
      where: { id },
    });
    if (!reminder || reminder.userId !== userId)
      throw new NotFoundException(`Reminder with ID ${id} not found`);

    return this.databaseSvc.reminder.update({
      where: { id },
      data,
    });
  }

  public async delete(userId: string, id: string): Promise<Reminder> {
    const reminder = await this.databaseSvc.reminder.findUnique({
      where: { id },
    });
    if (!reminder || reminder.userId !== userId)
      throw new NotFoundException(`Reminder with ID ${id} not found`);

    return this.databaseSvc.reminder.delete({
      where: { id },
    });
  }

  public async registerPushToken(
    userId: string,
    pushToken: string,
  ): Promise<void> {
    await this.databaseSvc.user.update({
      where: { id: userId },
      data: { pushToken },
    });
  }

  /**
   * Find users who have habits due today but haven't completed any.
   * This is used for "streak at risk" notifications.
   */
  public async findStreakAtRiskUsers(): Promise<
    { userId: string; pushToken: string; habitCount: number }[]
  > {
    const today = new Date().toISOString().split('T')[0];

    const usersWithReminders = await this.databaseSvc.user.findMany({
      where: {
        pushToken: { not: null },
        reminders: { some: { enabled: true } },
      },
      select: {
        id: true,
        pushToken: true,
        habits: {
          where: { isArchived: false },
          select: {
            id: true,
            completions: {
              where: { date: today, status: true },
            },
          },
        },
      },
    });

    return usersWithReminders
      .filter(
        (user) =>
          user.habits.length > 0 &&
          user.habits.every((h) => h.completions.length === 0),
      )
      .map((user) => ({
        userId: user.id,
        pushToken: user.pushToken!,
        habitCount: user.habits.length,
      }));
  }
}
