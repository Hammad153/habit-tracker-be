import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../../core/database/database.service';
import { AwardsService } from '../awards/awards.service';
import { ProfileService } from '../profile/profile.service';
import { XP_PER_COMPLETION } from '../../core/utils/progression.utils';
import {
  CreateDailyPlanDto,
  CreateDailyPlanTaskDto,
  UpdateDailyPlanDto,
  UpdateDailyPlanTaskDto,
} from './dto/daily-plan.dto';

type Db = DatabaseService | Prisma.TransactionClient;

@Injectable()
export class DailyPlanService {
  constructor(
    private readonly databaseSvc: DatabaseService,
    private readonly profileSvc: ProfileService,
    private readonly awardsSvc: AwardsService,
  ) {}

  private parseDate(value?: string) {
    if (!value) return undefined;
    const key = value.slice(0, 10);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (!match) throw new BadRequestException('Invalid date supplied');
    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  private dateKey(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  private dayWindow(value?: string) {
    const day = this.parseDate(value) ?? this.parseDate(new Date().toISOString())!;
    const end = new Date(day);
    end.setHours(23, 59, 59, 999);
    return { start: day, end };
  }

  private taskInclude = { habit: true };

  private planInclude = {
    tasks: {
      orderBy: [{ sortOrder: 'asc' as const }, { startTime: 'asc' as const }, { createdAt: 'asc' as const }],
      include: this.taskInclude,
    },
  };

  private timeToMinutes(value?: string | null) {
    if (!value) return undefined;
    const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
    if (!match) throw new BadRequestException('Time must use HH:mm format');
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) throw new BadRequestException('Time is outside a valid day');
    return hours * 60 + minutes;
  }

  private minutesToTime(value: number) {
    const normalized = Math.max(0, Math.min(value, 23 * 60 + 59));
    const hours = Math.floor(normalized / 60);
    const minutes = normalized % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }

  private normalizeTask(data: Partial<CreateDailyPlanTaskDto | UpdateDailyPlanTaskDto>, fallbackOrder = 0) {
    const startMinutes = this.timeToMinutes(data.startTime);
    let endTime = data.endTime?.trim() || undefined;
    let durationMinutes = data.durationMinutes;
    const endMinutes = this.timeToMinutes(endTime);

    if (startMinutes !== undefined && durationMinutes !== undefined && !endTime) {
      endTime = this.minutesToTime(startMinutes + durationMinutes);
    } else if (startMinutes !== undefined && endMinutes !== undefined && durationMinutes === undefined) {
      durationMinutes = endMinutes - startMinutes;
    }

    if (durationMinutes !== undefined && durationMinutes <= 0) {
      throw new BadRequestException('Duration must be greater than zero');
    }
    if (startMinutes !== undefined && endTime) {
      const normalizedEnd = this.timeToMinutes(endTime);
      if (normalizedEnd !== undefined && normalizedEnd < startMinutes) {
        throw new BadRequestException('End time must not be earlier than start time');
      }
    }

    return {
      habitId: data.linkedHabitId ?? data.habitId,
      title: data.title?.trim(),
      description: data.description?.trim() || null,
      priority: (data.priority ?? 'MEDIUM') as any,
      status: (data.status ?? 'PENDING') as any,
      startTime: data.startTime?.trim() || null,
      endTime: endTime ?? null,
      durationMinutes: durationMinutes ?? null,
      sortOrder: data.order ?? data.sortOrder ?? fallbackOrder,
    };
  }

  private mapTask(task: any) {
    return {
      ...task,
      linkedHabitId: task.habitId,
      linkedHabit: task.habit
        ? {
            id: task.habit.id,
            name: task.habit.title,
            title: task.habit.title,
          }
        : undefined,
      order: task.sortOrder,
    };
  }

  private mapPlan(plan: any) {
    const rawTasks = [...(plan.tasks ?? [])].sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return (a.startTime ?? '').localeCompare(b.startTime ?? '');
    });
    const items = rawTasks.map((task) => this.mapTask(task));
    const activeItems = items.filter((item) => item.status !== 'SKIPPED');
    const completedItems = items.filter((item) => item.status === 'COMPLETED').length;
    const totalItems = items.length;
    const pending = items.filter((item) => item.status === 'PENDING');
    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    const nextItem =
      pending.find((item) => {
        const start = this.timeToMinutes(item.startTime);
        return start === undefined || start >= nowMinutes;
      }) ?? pending[0];
    const startTimes = activeItems.map((item) => item.startTime).filter(Boolean);
    const endTimes = activeItems.map((item) => item.endTime).filter(Boolean);
    const status = totalItems === 0 ? 'NOT_STARTED' : completedItems === totalItems ? 'COMPLETED' : completedItems > 0 ? 'IN_PROGRESS' : 'NOT_STARTED';

    return {
      ...plan,
      items,
      tasks: items,
      status,
      totalItems,
      completedItems,
      totalTasks: totalItems,
      completedTasks: completedItems,
      pendingTasks: Math.max(totalItems - completedItems, 0),
      progressPercentage: totalItems ? Math.round((completedItems / totalItems) * 100) : 0,
      completionPercentage: totalItems ? Math.round((completedItems / totalItems) * 100) : 0,
      nextItem,
      dayStartTime: startTimes.sort()[0],
      dayEndTime: endTimes.sort().at(-1),
    };
  }

  private async ensurePlan(userId: string, id: string, db: Db = this.databaseSvc) {
    const plan = await db.dailyPlan.findFirst({
      where: { id, userId },
      include: this.planInclude,
    });
    if (!plan) throw new NotFoundException(`Daily plan with ID ${id} not found`);
    return plan;
  }

  private async ensureTask(userId: string, id: string, db: Db = this.databaseSvc) {
    const task = await db.dailyPlanTask.findFirst({
      where: { id, userId },
      include: { dailyPlan: true, habit: true },
    });
    if (!task) throw new NotFoundException(`Activity with ID ${id} not found`);
    return task;
  }

  private async ensureHabit(userId: string, habitId?: string | null, db: Db = this.databaseSvc) {
    if (!habitId) return null;
    const habit = await db.habit.findFirst({ where: { id: habitId, userId } });
    if (!habit) throw new NotFoundException(`Habit with ID ${habitId} not found`);
    return habit;
  }

  private async replaceItems(userId: string, planId: string, items: CreateDailyPlanTaskDto[], db: Db) {
    const existing = await db.dailyPlanTask.findMany({ where: { userId, dailyPlanId: planId } });
    await Promise.all(
      existing.map((task) => this.removeDailyPlanCompletion(task.habitId, task.id, db)),
    );
    await db.dailyPlanTask.deleteMany({ where: { userId, dailyPlanId: planId } });
    for (const [index, item] of items.entries()) {
      const normalized = this.normalizeTask(item, index);
      await this.ensureHabit(userId, normalized.habitId, db);
      await db.dailyPlanTask.create({
        data: {
          userId,
          dailyPlanId: planId,
          habitId: normalized.habitId,
          title: normalized.title!,
          description: normalized.description,
          priority: normalized.priority,
          status: normalized.status,
          startTime: normalized.startTime,
          endTime: normalized.endTime,
          durationMinutes: normalized.durationMinutes,
          completedAt: normalized.status === 'COMPLETED' ? new Date() : null,
          sortOrder: normalized.sortOrder,
        } as any,
      });
    }
  }

  private async removeDailyPlanCompletion(habitId: string | null, taskId: string, db: Db) {
    if (!habitId) return false;
    const completion = await db.completion.findFirst({
      where: { habitId, source: 'DAILY_PLAN', sourceReferenceId: taskId } as any,
    });
    if (!completion) return false;
    await db.completion.delete({ where: { id: completion.id } });
    return completion.status;
  }

  private async syncCompletion(userId: string, task: any, nextStatus: string, db: Db) {
    if (!task.habitId) return { xpDelta: 0, shouldCheckAwards: false };
    const habit = await this.ensureHabit(userId, task.habitId, db);
    const date = this.dateKey(task.dailyPlan.planDate);
    const existing = await db.completion.findUnique({ where: { habitId_date: { habitId: task.habitId, date } } });

    if (nextStatus === 'COMPLETED') {
      if (existing?.status) return { xpDelta: 0, shouldCheckAwards: false };
      if (existing) {
        await db.completion.update({
          where: { id: existing.id },
          data: {
            status: true,
            value: habit?.goal ?? 1,
            source: 'DAILY_PLAN' as any,
            sourceReferenceId: task.id,
          } as any,
        });
      } else {
        await db.completion.create({
          data: {
            habitId: task.habitId,
            date,
            status: true,
            value: habit?.goal ?? 1,
            source: 'DAILY_PLAN' as any,
            sourceReferenceId: task.id,
          } as any,
        });
      }
      return { xpDelta: XP_PER_COMPLETION, shouldCheckAwards: true };
    }

    const sourcedCompletion = existing as any;
    if (task.status === 'COMPLETED' && sourcedCompletion?.source === 'DAILY_PLAN' && sourcedCompletion.sourceReferenceId === task.id) {
      await db.completion.delete({ where: { id: sourcedCompletion.id } });
      return { xpDelta: -XP_PER_COMPLETION, shouldCheckAwards: false };
    }
    return { xpDelta: 0, shouldCheckAwards: false };
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
    const plans = await this.databaseSvc.dailyPlan.findMany({
      where,
      include: this.planInclude,
      orderBy: { planDate: 'desc' },
    });
    return plans.map((plan) => this.mapPlan(plan));
  }

  async createPlan(userId: string, data: CreateDailyPlanDto) {
    const planDate = this.parseDate(data.planDate)!;
    const plan = await this.databaseSvc.$transaction(async (tx) => {
      const saved = await tx.dailyPlan.upsert({
        where: { userId_planDate: { userId, planDate } },
        update: { title: data.title, note: data.note },
        create: { userId, planDate, title: data.title, note: data.note },
      });
      if (Array.isArray(data.items)) await this.replaceItems(userId, saved.id, data.items, tx);
      return tx.dailyPlan.findUniqueOrThrow({ where: { id: saved.id }, include: this.planInclude });
    });
    return this.mapPlan(plan);
  }

  async updatePlan(userId: string, id: string, data: UpdateDailyPlanDto) {
    await this.ensurePlan(userId, id);
    const plan = await this.databaseSvc.$transaction(async (tx) => {
      const saved = await tx.dailyPlan.update({
        where: { id },
        data: {
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.note !== undefined ? { note: data.note } : {}),
          ...(data.planDate !== undefined ? { planDate: this.parseDate(data.planDate) } : {}),
        },
      });
      if (Array.isArray(data.items)) await this.replaceItems(userId, saved.id, data.items, tx);
      return tx.dailyPlan.findUniqueOrThrow({ where: { id: saved.id }, include: this.planInclude });
    });
    return this.mapPlan(plan);
  }

  async deletePlan(userId: string, id: string) {
    await this.ensurePlan(userId, id);
    return this.databaseSvc.dailyPlan.delete({ where: { id } });
  }

  async createTask(userId: string, data: CreateDailyPlanTaskDto) {
    if (!data.dailyPlanId) throw new BadRequestException('dailyPlanId is required');
    await this.ensurePlan(userId, data.dailyPlanId);
    const maxTask = await this.databaseSvc.dailyPlanTask.findFirst({
      where: { dailyPlanId: data.dailyPlanId, userId },
      orderBy: { sortOrder: 'desc' },
    });
    const normalized = this.normalizeTask(data, (maxTask?.sortOrder ?? -1) + 1);
    await this.ensureHabit(userId, normalized.habitId);
    const task = await this.databaseSvc.dailyPlanTask.create({
      data: {
        userId,
        dailyPlanId: data.dailyPlanId,
        habitId: normalized.habitId,
        title: normalized.title!,
        description: normalized.description,
        priority: normalized.priority,
        status: normalized.status,
        startTime: normalized.startTime,
        endTime: normalized.endTime,
        durationMinutes: normalized.durationMinutes,
        completedAt: normalized.status === 'COMPLETED' ? new Date() : null,
        sortOrder: normalized.sortOrder,
      } as any,
      include: this.taskInclude,
    });
    return this.mapTask(task);
  }

  async updateTask(userId: string, id: string, data: UpdateDailyPlanTaskDto) {
    const existing = await this.ensureTask(userId, id);
    if (data.dailyPlanId) await this.ensurePlan(userId, data.dailyPlanId);
    const normalized = this.normalizeTask({ ...(existing as any), ...data }, existing.sortOrder);
    await this.ensureHabit(userId, normalized.habitId);
    const nextStatus = data.status ?? existing.status;
    const sync = await this.databaseSvc.$transaction(async (tx) => {
      const syncResult = await this.syncCompletion(userId, existing, nextStatus, tx);
      const task = await tx.dailyPlanTask.update({
        where: { id },
        data: {
          ...(data.dailyPlanId !== undefined ? { dailyPlanId: data.dailyPlanId } : {}),
          ...(data.habitId !== undefined || data.linkedHabitId !== undefined ? { habitId: normalized.habitId } : {}),
          ...(data.title !== undefined ? { title: normalized.title } : {}),
          ...(data.description !== undefined ? { description: normalized.description } : {}),
          ...(data.priority !== undefined ? { priority: normalized.priority } : {}),
          ...(data.status !== undefined
            ? {
                status: nextStatus as any,
                completedAt: nextStatus === 'COMPLETED' ? (existing as any).completedAt ?? new Date() : null,
              }
            : {}),
          ...(data.startTime !== undefined ? { startTime: normalized.startTime } : {}),
          ...(data.endTime !== undefined || data.durationMinutes !== undefined
            ? { endTime: normalized.endTime, durationMinutes: normalized.durationMinutes }
            : {}),
          ...(data.sortOrder !== undefined || data.order !== undefined ? { sortOrder: normalized.sortOrder } : {}),
        } as any,
        include: this.taskInclude,
      });
      return { task, ...syncResult };
    });

    if (sync.xpDelta) await this.profileSvc.addExperience(userId, sync.xpDelta);
    if (sync.shouldCheckAwards) await this.awardsSvc.checkAndAwardBadges(userId);
    return this.mapTask(sync.task);
  }

  async reorderTasks(userId: string, taskIds: string[]) {
    const tasks = await this.databaseSvc.dailyPlanTask.findMany({
      where: { userId, id: { in: taskIds } },
    });
    if (tasks.length !== taskIds.length) {
      throw new NotFoundException('One or more activities were not found');
    }
    const planIds = new Set(tasks.map((task) => task.dailyPlanId));
    if (planIds.size > 1) throw new BadRequestException('Activities must belong to the same Daily Plan');
    await this.databaseSvc.$transaction(
      taskIds.map((id, sortOrder) =>
        this.databaseSvc.dailyPlanTask.update({ where: { id }, data: { sortOrder } }),
      ),
    );
    return { success: true };
  }

  async deleteTask(userId: string, id: string) {
    const task = await this.ensureTask(userId, id);
    const removedCompletion = await this.databaseSvc.$transaction(async (tx) => {
      const removed = await this.removeDailyPlanCompletion(task.habitId, task.id, tx);
      await tx.dailyPlanTask.delete({ where: { id } });
      const remaining = await tx.dailyPlanTask.findMany({
        where: { userId, dailyPlanId: task.dailyPlanId },
        orderBy: [{ sortOrder: 'asc' }, { startTime: 'asc' }, { createdAt: 'asc' }],
      });
      await Promise.all(remaining.map((item, sortOrder) => tx.dailyPlanTask.update({ where: { id: item.id }, data: { sortOrder } })));
      return removed;
    });
    if (removedCompletion) await this.profileSvc.addExperience(userId, -XP_PER_COMPLETION);
    return { success: true };
  }

  async summary(userId: string, date?: string) {
    const [plan] = await this.plans(userId, date ?? new Date().toISOString());
    return {
      plan: plan ?? null,
      totalTasks: plan?.totalItems ?? 0,
      completedTasks: plan?.completedItems ?? 0,
      pendingTasks: plan?.pendingTasks ?? 0,
      completionPercentage: plan?.progressPercentage ?? 0,
      highPriorityOpen: (plan?.items ?? []).filter((task) => task.priority === 'HIGH' && task.status !== 'COMPLETED').length,
      nextItem: plan?.nextItem,
      status: plan?.status ?? 'NOT_STARTED',
    };
  }
}
