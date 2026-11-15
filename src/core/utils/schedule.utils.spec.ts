import { isScheduledOnDate } from './schedule.utils';

describe('schedule contract', () => {
  it('allows any day for weekly quotas', () => {
    const habit = { scheduleType: 'times_per_week', timesPerWeek: 3 };
    expect(isScheduledOnDate(habit, '2026-07-10')).toBe(true);
    expect(isScheduledOnDate(habit, '2026-07-11')).toBe(true);
  });

  it('anchors intervals to startDate, then createdAt', () => {
    const habit = { scheduleType: 'interval', intervalDays: 2, startDate: '2026-07-10', createdAt: '2026-07-01' };
    expect(isScheduledOnDate(habit, '2026-07-09')).toBe(false);
    expect(isScheduledOnDate(habit, '2026-07-10')).toBe(true);
    expect(isScheduledOnDate(habit, '2026-07-11')).toBe(false);
    expect(isScheduledOnDate(habit, '2026-07-12')).toBe(true);
    expect(isScheduledOnDate({ scheduleType: 'interval', intervalDays: 2, createdAt: '2026-07-01' }, '2026-07-03')).toBe(true);
  });

  it('handles leap day and DST as calendar days', () => {
    const leap = { scheduleType: 'interval', intervalDays: 2, startDate: '2024-02-28' };
    expect(isScheduledOnDate(leap, '2024-02-29')).toBe(false);
    expect(isScheduledOnDate(leap, '2024-03-01')).toBe(true);
    const dst = { scheduleType: 'interval', intervalDays: 2, startDate: '2026-03-07' };
    expect(isScheduledOnDate(dst, '2026-03-09')).toBe(true);
  });
});
