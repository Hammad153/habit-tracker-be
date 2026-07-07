import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../../core/database/database.service';
import {
  CreateDailyPlanDto,
  CreateDailyPlanTaskDto,
  UpdateDailyPlanDto,
  UpdateDailyPlanTaskDto,
} from './dto/daily-plan.dto';

@Injectable()
export class DailyPlanService {
  constructor(private readonly databaseSvc: DatabaseService) {}

  private parseDate(value?: string) {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Invalid date supplied');
    }
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private dayWindow(value?: string) {
    const day = this.parseDate(value) ?? this.parseDate(new Date().toISOString())!;
    const end = new Date(day);
    end.setHours(23, 59, 59, 999);
    return { start: day, end };
  }

  private async ensurePlan(userId: string, id: string) {
    const plan = await this.databaseSvc.dailyPlan.findFirst({
      where: { id, userId },
      include: { tasks: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], include: { habit: true } } },
    });
    if (!plan) throw new NotFoundException(`Daily plan with ID ${id} not found`);
    return plan;
  }

  private async ensureTask(userId: string, id: string) {
    const task = await this.databaseSvc.dailyPlanTask.findFirst({ where: { id, userId } });
    if (!task) throw new NotFoundException(`Task with ID ${id} not found`);
    return task;
  }

  private async ensureHabit(userId: string, habitId?: string | null) {
    if (!habitId) return null;
    const habit = await this.databaseSvc.habit.findFirst({ where: { id: habitId, userId } });
    if (!habit) throw new NotFoundException(`Habit with ID ${habitId} not found`);
    return habit;
  }

  async plans(userId: string, date?: string, startDate?: string, endDate?: string) {
    const where: Prisma.DailyPlanWhereInput = { userId };
    if (date) {
      const { start, end } = this.dayWindow(date);
      where.planDate = { gte: start, lte: end };
    } else if (startDate || endDate) {
      where.planDate = {
        gte: this.parseDate(startDate),
        lte: endDate ? this.dayWindow(endDate).end : undefined,
      };
    }
    return this.databaseSvc.dailyPlan.findMany({
      where,
      include: {
        tasks: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: { habit: true },
        },
      },
      orderBy: { planDate: 'desc' },
    });
  }

  async createPlan(userId: string, data: CreateDailyPlanDto) {
    const planDate = this.parseDate(data.planDate)!;
    return this.databaseSvc.dailyPlan.upsert({
      where: { userId_planDate: { userId, planDate } },
      update: { title: data.title, note: data.note },
      create: { userId, planDate, title: data.title, note: data.note },
      include: { tasks: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], include: { habit: true } } },
    });
  }

  async updatePlan(userId: string, id: string, data: UpdateDailyPlanDto) {
    await this.ensurePlan(userId, id);
    return this.databaseSvc.dailyPlan.update({
      where: { id },
      data: { title: data.title, note: data.note, planDate: this.parseDate(data.planDate) },
      include: { tasks: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], include: { habit: true } } },
    });
  }

  async deletePlan(userId: string, id: string) {
    await this.ensurePlan(userId, id);
    return this.databaseSvc.dailyPlan.delete({ where: { id } });
  }

  async createTask(userId: string, data: CreateDailyPlanTaskDto) {
    await this.ensurePlan(userId, data.dailyPlanId);
    await this.ensureHabit(userId, data.habitId);
    const maxTask = await this.databaseSvc.dailyPlanTask.findFirst({
      where: { dailyPlanId: data.dailyPlanId, userId },
      orderBy: { sortOrder: 'desc' },
    });
    return this.databaseSvc.dailyPlanTask.create({
      data: {
        ...data,
        userId,
        priority: data.priority as any,
        status: (data.status ?? 'PENDING') as any,
        sortOrder: data.sortOrder ?? (maxTask?.sortOrder ?? -1) + 1,
      },
      include: { habit: true },
    });
  }

  async updateTask(userId: string, id: string, data: UpdateDailyPlanTaskDto) {
    await this.ensureTask(userId, id);
    if (data.dailyPlanId) await this.ensurePlan(userId, data.dailyPlanId);
    await this.ensureHabit(userId, data.habitId);
    return this.databaseSvc.dailyPlanTask.update({
      where: { id },
      data: {
        ...data,
        priority: data.priority as any,
        status: data.status as any,
      },
      include: { habit: true },
    });
  }

  async reorderTasks(userId: string, taskIds: string[]) {
    const tasks = await this.databaseSvc.dailyPlanTask.findMany({
      where: { userId, id: { in: taskIds } },
    });
    if (tasks.length !== taskIds.length) {
      throw new NotFoundException('One or more tasks were not found');
    }
    await this.databaseSvc.$transaction(
      taskIds.map((id, sortOrder) =>
        this.databaseSvc.dailyPlanTask.update({ where: { id }, data: { sortOrder } }),
      ),
    );
    return { success: true };
  }

  async deleteTask(userId: string, id: string) {
    await this.ensureTask(userId, id);
    return this.databaseSvc.dailyPlanTask.delete({ where: { id } });
  }

  async summary(userId: string, date?: string) {
    const [plan] = await this.plans(userId, date ?? new Date().toISOString());
    const tasks = plan?.tasks ?? [];
    const completed = tasks.filter((task) => task.status === 'COMPLETED').length;
    return {
      plan: plan ?? null,
      totalTasks: tasks.length,
      completedTasks: completed,
      pendingTasks: Math.max(tasks.length - completed, 0),
      completionPercentage: tasks.length ? Math.round((completed / tasks.length) * 100) : 0,
      highPriorityOpen: tasks.filter((task) => task.priority === 'HIGH' && task.status !== 'COMPLETED').length,
    };
  }
}
