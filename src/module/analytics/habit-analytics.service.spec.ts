import { NotFoundException, BadRequestException } from '@nestjs/common';
import { HabitAnalyticsService } from './habit-analytics.service';
import { DatabaseService } from '../../core/database/database.service';

const makeDb = () => ({
  habit: { findFirst: jest.fn() },
  user: { findUnique: jest.fn().mockResolvedValue({ timezone: null }) },
});

const buildService = (db: ReturnType<typeof makeDb>) =>
  new HabitAnalyticsService(db as unknown as DatabaseService);

const HABIT_ROW = {
  id: 'habit-1',
  userId: 'user-1',
  title: 'Read',
  goal: 20,
  unit: 'pages',
  scheduleType: 'daily',
  scheduleDays: [],
  timesPerWeek: null,
  intervalDays: null,
  scheduledTime: '20:00',
  startDate: new Date('2026-08-01T00:00:00.000Z'),
  isArchived: false,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  completions: [
    {
      date: '2026-08-22',
      status: true,
      value: 20,
      kind: 'FULL',
      createdAt: new Date('2026-08-22T07:30:00.000Z'),
    },
  ],
};

describe('HabitAnalyticsService', () => {
  it('throws NotFound when the habit does not exist or belongs to someone else', async () => {
    const db = makeDb();
    db.habit.findFirst.mockResolvedValue(null);
    const svc = buildService(db);
    await expect(svc.getHabitBehaviorReport('user-1', 'missing')).rejects.toThrow(
      NotFoundException,
    );
    await expect(svc.getHabitRisk('user-1', 'missing')).rejects.toThrow(NotFoundException);
  });

  it('scopes lookups by owner so another users habit is invisible', async () => {
    const db = makeDb();
    db.habit.findFirst.mockImplementation(({ where }) =>
      where.id === 'habit-1' && where.userId === 'owner'
        ? Promise.resolve(HABIT_ROW)
        : Promise.resolve(null),
    );
    const svc = buildService(db);
    await expect(svc.getHabitBehaviorReport('intruder', 'habit-1')).rejects.toThrow(
      NotFoundException,
    );
    expect(db.habit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'habit-1', userId: 'intruder' },
      }),
    );
  });

  it('rejects malformed date params with BadRequest', async () => {
    const db = makeDb();
    db.habit.findFirst.mockResolvedValue(HABIT_ROW);
    const svc = buildService(db);
    for (const bad of ['not-a-date', '2026/08/23', '2026-13-40']) {
      await expect(svc.getHabitBehaviorReport('user-1', 'habit-1', bad)).rejects.toThrow(
        BadRequestException,
      );
    }
  });

  it('builds a full behavior report with identity fields intact', async () => {
    const db = makeDb();
    db.habit.findFirst.mockResolvedValue(HABIT_ROW);
    const svc = buildService(db);
    const report = await svc.getHabitBehaviorReport('user-1', 'habit-1');

    expect(report.habitId).toBe('habit-1');
    expect(report.habitTitle).toBe('Read');
    expect(report.isArchived).toBe(false);
    expect(report.analyzedAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(report.timezoneUsed).toBe('UTC'); // no user tz stored -> fallback
    // Window Aug 17-23: only Aug 22 was completed of six elapsed days.
    expect(report.completionRates.d7).toMatchObject({ completed: 1, expected: 6 });
    expect(report.completionRates.d7.rate).toBeCloseTo(1 / 6);
    expect(report.streaks.current).toBeGreaterThanOrEqual(1);
    expect(report.risk).toHaveProperty('score');
    expect(report.momentum).toHaveProperty('level');
    expect(Array.isArray(report.signals)).toBe(true);
  });

  it('honors an explicit asOf date and maps unknown kinds to FULL safely', async () => {
    const row = {
      ...HABIT_ROW,
      completions: [
        { ...HABIT_ROW.completions[0], kind: 'SOMETHING_NEW' }, // future-proofing
        {
          date: '2026-08-21',
          status: true,
          value: 10,
          kind: 'MINIMUM',
          createdAt: null, // legacy rows may pre-date createdAt
        },
      ],
    };
    const db = makeDb();
    db.habit.findFirst.mockResolvedValue(row);
    const svc = buildService(db);
    const report = await svc.getHabitBehaviorReport('user-1', 'habit-1', '2026-08-23');

    expect(report.analyzedAsOf).toBe('2026-08-23');
    expect(report.completionRates.d7.completed).toBe(2);
  });

  it('returns the compact risk view derived from the same report', async () => {
    const db = makeDb();
    db.habit.findFirst.mockResolvedValue(HABIT_ROW);
    const svc = buildService(db);
    const risk = await svc.getHabitRisk('user-1', 'habit-1');

    expect(risk.habitId).toBe('habit-1');
    expect(risk.analyzedAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(risk.risk).toHaveProperty('score');
    expect(risk.momentum).toHaveProperty('level');
    expect(Array.isArray(risk.signals)).toBe(true);
    expect(Array.isArray(risk.structuredSignals)).toBe(true);
    expect(typeof risk.insufficientHistory).toBe('boolean');
  });

  it('uses the stored user timezone for time-of-day bucketing', async () => {
    const db = makeDb();
    db.user.findUnique.mockResolvedValue({ timezone: 'Asia/Karachi' });
    db.habit.findFirst.mockResolvedValue({
      ...HABIT_ROW,
      completions: [
        ...HABIT_ROW.completions,
        // 20:30 UTC == 01:30 PKT (next day) -> NIGHT bucket in Karachi.
        {
          date: '2026-08-20',
          status: true,
          value: 20,
          kind: 'FULL',
          createdAt: new Date('2026-08-19T20:30:00.000Z'),
        },
        // 06:15 UTC == 11:15 PKT -> MORNING bucket in Karachi.
        {
          date: '2026-08-21',
          status: true,
          value: 20,
          kind: 'FULL',
          createdAt: new Date('2026-08-21T06:15:00.000Z'),
        },
      ],
    });
    const svc = buildService(db);
    const report = await svc.getHabitBehaviorReport('user-1', 'habit-1');

    expect(report.timezoneUsed).toBe('Asia/Karachi');
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { timezone: true },
    });
  });
});
