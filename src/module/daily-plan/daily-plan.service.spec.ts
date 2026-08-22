import { NotFoundException } from '@nestjs/common';
import { DailyPlanService } from './daily-plan.service';

const makeService = () => {
  const tx = {
    dailyPlan: {
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    dailyPlanTask: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(({ data }) =>
        Promise.resolve({ id: 'task-new', ...data, habit: null }),
      ),
      update: jest.fn(({ data }) =>
        Promise.resolve({ id: 'task-1', ...data }),
      ),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    completion: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(({ data }) =>
        Promise.resolve({ id: 'completion-new', ...data }),
      ),
      update: jest.fn(),
      delete: jest.fn(),
    },
    habit: { findFirst: jest.fn(), findUniqueOrThrow: jest.fn() },
  };

  const database = {
    ...tx,
    $transaction: jest.fn((fn: any) => fn(tx)),
    tx,
  };

  const profileSvc = { addExperience: jest.fn(), addExperienceTx: jest.fn() };
  const awardsSvc = { checkAndAwardBadges: jest.fn() };
  const rewardsSvc = {
    awardForCompletion: jest.fn().mockResolvedValue(10),
    reverseCompletionAward: jest.fn().mockResolvedValue(10),
  };

  const service = new DailyPlanService(
    database as any,
    profileSvc as any,
    awardsSvc as any,
    rewardsSvc as any,
  );

  return { service, database, tx, profileSvc, awardsSvc, rewardsSvc };
};

const completedHabitTask = () => ({
  id: 'task-1',
  userId: 'user-1',
  status: 'PENDING',
  habitId: 'habit-1',
  sortOrder: 0,
  dailyPlan: { id: 'plan-1', planDate: new Date(2026, 7, 22) },
});

describe('DailyPlanService cross-endpoint completion safety', () => {
  it('marks a task complete and awards coins+XP exactly once', async () => {
    const s = makeService();
    s.database.dailyPlanTask.findFirst.mockResolvedValue(completedHabitTask());
    s.database.tx.completion.findUnique.mockResolvedValue(null);
    s.database.tx.habit.findFirst.mockResolvedValue({
      id: 'habit-1',
      userId: 'user-1',
      title: 'Read',
      goal: 20,
    });

    await s.service.updateTask('user-1', 'task-1', { status: 'COMPLETED' });

    expect(s.rewardsSvc.awardForCompletion).toHaveBeenCalledTimes(1);
    expect(s.profileSvc.addExperience).toHaveBeenCalledWith('user-1', 10);
  });

  it('does NOT double-award when the habit was already completed via the habit endpoint', async () => {
    const s = makeService();
    // The completion row exists and is already true (created by
    // POST /habit/{id}/toggle for the same habit + day key).
    s.database.dailyPlanTask.findFirst.mockResolvedValue(completedHabitTask());
    s.database.tx.completion.findUnique.mockResolvedValue({
      id: 'c-existing',
      habitId: 'habit-1',
      date: '2026-08-22',
      status: true,
      kind: 'FULL',
      source: null,
      sourceReferenceId: null,
    });
    s.database.tx.habit.findFirst.mockResolvedValue({
      id: 'habit-1',
      userId: 'user-1',
      title: 'Read',
      goal: 20,
    });

    await s.service.updateTask('user-1', 'task-1', { status: 'COMPLETED' });

    expect(s.rewardsSvc.awardForCompletion).not.toHaveBeenCalled();
    expect(s.profileSvc.addExperience).not.toHaveBeenCalled();
    expect(s.awardsSvc.checkAndAwardBadges).not.toHaveBeenCalled();
  });

  it('only reverses when the completion is still owned by this task', async () => {
    const s = makeService();
    const task = completedHabitTask();
    task.status = 'COMPLETED';
    s.database.dailyPlanTask.findFirst.mockResolvedValue(task);
    // Completion was re-created through the habit endpoint -> no longer ours.
    s.database.tx.completion.findUnique.mockResolvedValue({
      id: 'c-recreated',
      status: true,
      kind: 'FULL',
      source: null,
      sourceReferenceId: null,
    });
    s.database.habit.findFirst.mockResolvedValue({
      id: 'habit-1',
      userId: 'user-1',
      title: 'Read',
      goal: 20,
    });

    await s.service.updateTask('user-1', 'task-1', { status: 'PENDING' });

    expect(s.rewardsSvc.reverseCompletionAward).not.toHaveBeenCalled();
    expect(s.database.tx.completion.delete).not.toHaveBeenCalled();
    expect(s.profileSvc.addExperience).not.toHaveBeenCalled();
  });

  it('derives the completion day key from local calendar components', async () => {
    const s = makeService();
    const task = completedHabitTask();
    s.database.dailyPlanTask.findFirst.mockResolvedValue(task);
    s.database.tx.completion.findUnique.mockResolvedValue(null);
    s.database.tx.habit.findFirst.mockResolvedValue({
      id: 'habit-1',
      userId: 'user-1',
      title: 'Read',
      goal: 20,
    });

    await s.service.updateTask('user-1', 'task-1', { status: 'COMPLETED' });

    // planDate Aug 22 must produce the exact key "2026-08-22", independent of TZ.
    expect(s.database.tx.completion.findUnique).toHaveBeenCalledWith({
      where: {
        habitId_date: { habitId: 'habit-1', date: '2026-08-22' },
      },
    });
  });

  it('scopes task lookups to the authenticated user', async () => {
    const s = makeService();
    await expect(
      s.service.updateTask('user-other', 'task-1', { status: 'COMPLETED' }),
    ).rejects.toThrow(NotFoundException);
  });
});
