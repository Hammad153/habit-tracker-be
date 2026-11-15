import { ConflictException, NotFoundException } from '@nestjs/common';
import { HabitService } from './habit.service';

const makeSubject = () => {
  const habit = { id: 'h1', userId: 'u1', title: 'Read', createdAt: new Date('2026-11-01'), lifecycleStatus: 'ACTIVE', version: 0, isArchived: false };
  const tx = {
    habit: { findFirst: jest.fn().mockResolvedValue(habit), findUniqueOrThrow: jest.fn().mockResolvedValue(habit), updateMany: jest.fn().mockResolvedValue({ count: 1 }), create: jest.fn().mockResolvedValue({ id: 'h2' }) },
    habitBurial: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn(), count: jest.fn().mockResolvedValue(0), create: jest.fn(({ data }) => Promise.resolve({ id: 'b1', ...data })), update: jest.fn() },
    habitLifecycleEvent: { create: jest.fn().mockResolvedValue({}), findFirst: jest.fn().mockResolvedValue(null) },
    completion: { findMany: jest.fn().mockResolvedValue([]) },
    reminder: { findFirst: jest.fn().mockResolvedValue(null), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const db = { habitBurial: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn() }, $transaction: jest.fn((fn) => fn(tx)) };
  const service = new HabitService(db as any, {} as any, {} as any, {} as any, {} as any);
  return { service, db, tx, habit };
};

describe('habit burial lifecycle', () => {
  it('buries and disables reminders in one transaction', async () => {
    const s = makeSubject();
    const result = await s.service.buryHabit('u1', 'h1', { commandId: 'c1', epitaph: 'A memorable ending.' });
    expect(result.id).toBe('b1');
    expect(s.tx.habit.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lifecycleStatus: 'BURIED', isArchived: true }) }));
    expect(s.tx.reminder.updateMany).toHaveBeenCalled();
    expect(s.tx.habitBurial.create).toHaveBeenCalledTimes(1);
  });

  it('returns an existing burial for a repeated command', async () => {
    const s = makeSubject();
    s.tx.habitBurial.findUnique.mockResolvedValue({ id: 'existing', habitId: 'h1' });
    expect((await s.service.buryHabit('u1', 'h1', { commandId: 'c1' })).id).toBe('existing');
    expect(s.tx.habit.updateMany).not.toHaveBeenCalled();
  });

  it('refuses burial of another account habit', async () => {
    const s = makeSubject();
    s.tx.habit.findFirst.mockResolvedValue(null);
    await expect(s.service.buryHabit('u2', 'h1', { commandId: 'c1' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects stale state', async () => {
    const s = makeSubject();
    s.tx.habit.updateMany.mockResolvedValue({ count: 0 });
    await expect(s.service.buryHabit('u1', 'h1', { commandId: 'c1' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('restores the original habit and keeps its tombstone', async () => {
    const s = makeSubject();
    s.tx.habit.findFirst.mockResolvedValue({ ...s.habit, lifecycleStatus: 'BURIED' });
    s.tx.habitBurial.findFirst.mockResolvedValue({ id: 'b1', habitId: 'h1', reminderEnabled: true });
    await s.service.restoreBurial('u1', 'b1');
    expect(s.tx.habitBurial.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'b1' }, data: expect.objectContaining({ restoredAt: expect.any(Date) }) }));
    expect(s.tx.reminder.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { enabled: true } }));
  });

  it('restarts as a new habit without copying completions', async () => {
    const s = makeSubject();
    s.tx.habit.findFirst.mockResolvedValue({ ...s.habit, lifecycleStatus: 'BURIED' });
    s.tx.habitBurial.findFirst.mockResolvedValue({ id: 'b1', habitId: 'h1' });
    const result = await s.service.restartBurial('u1', 'b1', 'h2');
    expect(result.id).toBe('h2');
    expect(s.tx.habit.create).toHaveBeenCalledWith({ data: expect.not.objectContaining({ completions: expect.anything() }) });
    expect(s.tx.habitBurial.update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { restartHabitId: 'h2' } });
  });

  it('pauses without archiving and disables reminders', async () => {
    const s = makeSubject();
    await s.service.transitionHabit('u1', 'h1', 'PAUSED');
    expect(s.tx.habit.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lifecycleStatus: 'PAUSED', isArchived: false }) }));
    expect(s.tx.reminder.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { enabled: false } }));
  });
});
