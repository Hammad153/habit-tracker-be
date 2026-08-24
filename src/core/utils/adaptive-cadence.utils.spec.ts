import {
  cooldownDaysFor,
  evaluateCadence,
  inQuietHours,
  priorityFor,
} from './adaptive-cadence.utils';

const base = {
  type: 'HABIT_AT_RISK' as const,
  interventionPriority: 78,
  fingerprint: 'fp-1',
  todayKey: '2026-08-23',
  localMinutes: 12 * 60, // noon
  coachEnabled: true,
  weeklyReviewEnabled: true,
  coachFrequency: 'STANDARD',
  scheduledToday: true,
  completedToday: false,
  recentlyDeliveredFingerprints: new Set<string>(),
  deliveriesToday: 0,
};

describe('cadence — frequency policy (spec §6)', () => {
  it('MINIMAL suppresses mid-priority nudges but keeps recovery/critical', () => {
    const minimal = { ...base, coachFrequency: 'MINIMAL' };
    expect(evaluateCadence(minimal).eligible).toBe(false);
    expect(
      evaluateCadence({ ...minimal, interventionPriority: 100 }).eligible,
    ).toBe(true);
    expect(
      evaluateCadence({ ...minimal, type: 'RECOVERY_NEEDED', interventionPriority: 80 })
        .eligible,
    ).toBe(false); // below MINIMAL floor of 90
  });

  it('STANDARD surfaces the normal engine range', () => {
    expect(evaluateCadence(base).eligible).toBe(true);
    expect(evaluateCadence({ ...base, interventionPriority: 70 }).eligible).toBe(true);
  });

  it('FREQUENT surfaces identity/momentum lows too', () => {
    expect(
      evaluateCadence({
        ...base,
        coachFrequency: 'FREQUENT',
        type: 'IDENTITY_REINFORCEMENT',
        interventionPriority: 70,
      }).eligible,
    ).toBe(true);
  });

  it('unknown frequency degrades to STANDARD semantics', () => {
    expect(evaluateCadence({ ...base, coachFrequency: 'WILD' }).eligible).toBe(true);
    expect(
      evaluateCadence({ ...base, coachFrequency: 'WILD', interventionPriority: 60 })
        .eligible,
    ).toBe(false);
  });
});

describe('cadence — CRITICAL bypass & preference gates', () => {
  it('CRITICAL bypasses frequency suppression', () => {
    const r = evaluateCadence({ ...base, coachFrequency: 'MINIMAL', interventionPriority: 100 });
    expect(r.eligible).toBe(true);
    expect(r.priority).toBe('URGENT');
    expect(r.reason).toBe('critical-bypass');
  });

  it('coachEnabled=false silences habit insights; weekly review still allowed', () => {
    const off = { ...base, coachEnabled: false };
    expect(evaluateCadence(off).reason).toBe('coach-disabled');
    const review = evaluateCadence({
      ...off,
      type: 'WEEKLY_REVIEW_READY',
      interventionPriority: 60,
    });
    expect(review.eligible).toBe(true);
  });

  it('weeklyReviewEnabled=false blocks review notification only', () => {
    const off = { ...base, weeklyReviewEnabled: false };
    const review = evaluateCadence({
      ...off,
      type: 'WEEKLY_REVIEW_READY',
      interventionPriority: 60,
    });
    expect(review.eligible).toBe(false);
    expect(review.reason).toBe('weekly-review-disabled');
    // Habit insight unaffected by the weekly toggle:
    expect(evaluateCadence(off).eligible).toBe(true);
  });
});

describe('cadence — spam protection', () => {
  it('cooldown suppresses identical fingerprints', () => {
    const r = evaluateCadence({
      ...base,
      recentlyDeliveredFingerprints: new Set(['fp-1']),
    });
    expect(r.reason).toBe('cooldown');
  });

  it('daily cap blocks further surfacing regardless of type', () => {
    const r = evaluateCadence({ ...base, deliveriesToday: 3 });
    expect(r.reason).toBe('daily-cap');
  });

  it('completed-today and unscheduled-day suppression for habit-scoped types', () => {
    expect(evaluateCadence({ ...base, completedToday: true }).reason).toBe(
      'completed-today',
    );
    expect(evaluateCadence({ ...base, scheduledToday: false }).reason).toBe(
      'not-scheduled-today',
    );
    // Portfolio types ignore these flags:
    expect(
      evaluateCadence({
        ...base,
        type: 'OVERLOAD_DETECTED',
        interventionPriority: 82,
        completedToday: true,
        scheduledToday: false,
      }).eligible,
    ).toBe(true);
  });
});

describe('cadence — timing & timezone inputs', () => {
  it('quiet hours: late night and early morning denied; boundary times pass', () => {
    expect(inQuietHours(22 * 60)).toBe(true); // 22:00 start
    expect(inQuietHours(23 * 60 + 59)).toBe(true);
    expect(inQuietHours(0)).toBe(true); // before 07:30
    expect(inQuietHours(7 * 60 + 29)).toBe(true);
    expect(inQuietHours(7 * 60 + 30)).toBe(false); // end-exclusive
    expect(inQuietHours(21 * 60 + 59)).toBe(false);

    expect(
      evaluateCadence({ ...base, localMinutes: 23 * 60 }).reason,
    ).toBe('quiet-hours');
    expect(
      evaluateCadence({ ...base, localMinutes: 7 * 60 + 30 }).eligible,
    ).toBe(true);
  });

  it('priority mapping derives from the intervention hierarchy only', () => {
    expect(priorityFor(100, 'RECOVERY_NEEDED')).toBe('URGENT');
    expect(priorityFor(92, 'DIFFICULTY_TOO_HIGH')).toBe('HIGH');
    expect(priorityFor(82, 'OVERLOAD_DETECTED')).toBe('HIGH');
    expect(priorityFor(76, 'MOMENTUM_PROTECTION')).toBe('LOW');
    expect(priorityFor(60, 'WEEKLY_REVIEW_READY')).toBe('LOW');
  });

  it('cooldown table covers every notification type deterministically', () => {
    expect(cooldownDaysFor('ADAPTATION_OUTCOME')).toBeGreaterThanOrEqual(300);
    expect(cooldownDaysFor('RECOVERY_NEEDED')).toBeLessThan(
      cooldownDaysFor('DIFFICULTY_TOO_HIGH'),
    );
  });
});
