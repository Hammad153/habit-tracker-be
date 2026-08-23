import {
  AnalyzedHabit,
  CompletionFact,
  buildBehaviorReport,
  bucketCodeForHhmm,
  buildDaySeries,
  computeMomentum,
  computeRiskScore,
  currentStreakFrom,
  detectDifficulty,
  detectWeekdayPatterns,
  expectedCompletions,
  longestStreakFromDates,
  missRateForWindow,
  rateForWindow,
  weekdayStats,
  zonedHhmm,
} from './behavior-analytics.utils';
import {
  BEHAVIOR_WINDOWS,
  RISK_LEVEL_BOUNDS,
  RISK_WEIGHTS,
  SIGNAL_THRESHOLDS,
} from './behavior.constants';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DAILY_HABIT: AnalyzedHabit = {
  id: 'habit-1',
  title: 'Read',
  goal: 20,
  scheduleType: 'daily',
};

/** N consecutive FULL completions ENDING at `endKey`. */
const run = (endKey: string, count: number, kind: CompletionFact['kind'] = 'FULL'): CompletionFact[] =>
  Array.from({ length: count }, (_, i) => {
    const d = new Date(`${endKey}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - (count - 1 - i));
    return {
      date: d.toISOString().slice(0, 10),
      status: true,
      value: 20,
      kind,
    };
  });

const TODAY = '2026-08-23';

// ---------------------------------------------------------------------------
// Completion-rate calculations
// ---------------------------------------------------------------------------

describe('behavior analytics — completion rates', () => {
  it('brand-new habit with no history → null rate and insufficient history flag', () => {
    const report = buildBehaviorReport({
      habit: { ...DAILY_HABIT, startDate: new Date(`${TODAY}T00:00:00.000Z`) },
      completions: [],
      todayKey: TODAY,
    });
    expect(report.insufficientHistory).toBe(true);
    // Nothing was expected yet -> rate is null (unknown), never fabricated 0%.
    expect(report.completionRates.d30.rate).toBeNull();
    expect(report.completionRates.d30.expected).toBe(0);
    expect(report.signals).toEqual([]);
    expect(report.structuredSignals).toEqual([{ type: 'INSUFFICIENT_HISTORY' }]);
    expect(report.risk.level).toBe('LOW');
  });

  it('a single completion on a brand-new habit yields a perfect recent rate', () => {
    const yesterday = '2026-08-22';
    const report = buildBehaviorReport({
      habit: { ...DAILY_HABIT, startDate: new Date(`${yesterday}T00:00:00.000Z`) },
      completions: [{ date: yesterday, status: true, value: 20, kind: 'FULL' }],
      todayKey: TODAY,
    });
    // Only yesterday was an elapsed scheduled day.
    expect(report.completionRates.d7).toMatchObject({ rate: 1, completed: 1, expected: 1 });
    expect(report.streaks.current).toBe(1);
    expect(report.streaks.longest).toBe(1);
    expect(report.insufficientHistory).toBe(false);
  });

  it('counts today when completed and excludes it while unfinished', () => {
    // Yesterday done, today not yet.
    let report = buildBehaviorReport({
      habit: DAILY_HABIT,
      completions: run('2026-08-22', 7),
      todayKey: TODAY,
    });
    expect(report.completionRates.d7.rate).toBe(1); // 7 past days all done

    // Today also done -> joins numerator AND denominator. The last-7 window
    // (Aug 17..23) contains six past days plus today.
    report = buildBehaviorReport({
      habit: DAILY_HABIT,
      completions: [...run('2026-08-22', 7), { date: TODAY, status: true, value: 20, kind: 'FULL' }],
      todayKey: TODAY,
    });
    expect(report.completionRates.d7).toMatchObject({ rate: 1, completed: 7, expected: 7 });
  });

  it('misses lower the rate but an unfinished today is not yet a miss', () => {
    // Window under test: Aug 17..23 (six past days + untouched today).
    const completions: CompletionFact[] = [
      { date: '2026-08-17', status: true, value: 20, kind: 'FULL' },
      { date: '2026-08-18', status: false, value: 0, kind: 'FULL' },
      { date: '2026-08-19', status: false, value: 0, kind: 'FULL' },
      { date: '2026-08-20', status: false, value: 0, kind: 'FULL' },
      { date: '2026-08-21', status: true, value: 20, kind: 'FULL' },
      { date: '2026-08-22', status: true, value: 20, kind: 'FULL' },
    ];
    const series = buildDaySeries(DAILY_HABIT, TODAY, 30, completions);
    const m = rateForWindow(series, DAILY_HABIT, 7);
    expect(m.completed).toBe(3);
    expect(m.expected).toBe(6);
    expect(m.rate).toBeCloseTo(0.5);

    const miss = missRateForWindow(series, DAILY_HABIT, 7);
    expect(miss.rate).toBeCloseTo(0.5);
  });

  it('new habit with startDate mid-window is only judged from its start', () => {
    const habit: AnalyzedHabit = { ...DAILY_HABIT, startDate: new Date('2026-08-21T00:00:00Z') };
    const series = buildDaySeries(habit, TODAY, BEHAVIOR_WINDOWS.MEDIUM, []);
    const m = rateForWindow(series, habit, BEHAVIOR_WINDOWS.MEDIUM);
    // Aug 21, 22 elapsed + today unfinished -> expected 2, completed 0.
    expect(m.expected).toBe(2);
    expect(m.rate).toBe(0); // genuinely missed both days
    expect(report_of(habit).insufficientHistory).toBe(true);
  });

  const report_of = (habit: AnalyzedHabit) =>
    buildBehaviorReport({ habit, completions: [], todayKey: TODAY });

  it('times_per_week habits are judged against their quota, not every day', () => {
    const habit: AnalyzedHabit = { id: 'h', scheduleType: 'times_per_week', timesPerWeek: 3 };
    // 90 eligible days in the long window; expectation for 7d = ceil(3)=3.
    const series = buildDaySeries(habit, TODAY, 90, [
      { date: '2026-08-17', status: true, value: 1, kind: 'FULL' },
      { date: '2026-08-19', status: true, value: 1, kind: 'FULL' },
    ]);
    const m = rateForWindow(series, habit, 7);
    expect(m.expected).toBe(3); // quota-based
    expect(m.completed).toBe(2);
    expect(m.rate).toBeCloseTo(2 / 3);

    expect(expectedCompletions(habit, 30, 30)).toBe(13); // ceil(3*30/7)
  });

  it('specific_days schedules only count configured weekdays as eligible', () => {
    const habit: AnalyzedHabit = {
      id: 'h',
      scheduleType: 'specific_days',
      scheduleDays: ['Sat', 'Sun'],
    };
    // Window ending Sun 2026-08-23: Sat 22 + Sun 23 are the last weekend days.
    const series = buildDaySeries(habit, TODAY, 8, [
      { date: '2026-08-22', status: true, value: 1, kind: 'FULL' },
    ]);
    const m = rateForWindow(series, habit, 7);
    // Past eligible: Sat 22 (+ Wed..Fri excluded). Today Sun unfinished.
    expect(m.expected).toBe(1);
    expect(m.completed).toBe(1);
    expect(m.rate).toBe(1);
  });

  it('archived habits remain analyzable and flagged', () => {
    const report = buildBehaviorReport({
      habit: { ...DAILY_HABIT, isArchived: true },
      completions: run(TODAY, 7),
      todayKey: TODAY,
    });
    expect(report.isArchived).toBe(true);
    expect(report.completionRates.d7.rate).toBe(1);
  });

  it('minimum-only history still counts as showing up', () => {
    const report = buildBehaviorReport({
      habit: DAILY_HABIT,
      completions: run(TODAY, 7, 'MINIMUM'),
      todayKey: TODAY,
    });
    expect(report.completionRates.d7.rate).toBe(1);
    expect(report.minimumCompletionRate30).toBe(1);
    expect(report.kindMix30.minimum.count).toBeGreaterThanOrEqual(7);
  });

  it('emergency-only history registers emergency share', () => {
    const report = buildBehaviorReport({
      habit: DAILY_HABIT,
      completions: run(TODAY, 10, 'EMERGENCY'),
      todayKey: TODAY,
    });
    expect(report.completionRates.d7.rate).toBe(1);
    expect(report.emergencyCompletionRate30).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Streaks
// ---------------------------------------------------------------------------

describe('behavior analytics — streaks', () => {
  it('longest streak survives gaps later in history', () => {
    // 5-day run, gap, then 2-day run.
    const dates = ['2026-08-01','2026-08-02','2026-08-03','2026-08-04','2026-08-05','2026-08-10','2026-08-11'];
    expect(longestStreakFromDates(dates)).toBe(5);
  });

  it('an uncompleted today does not break a streak alive through yesterday', () => {
    expect(currentStreakFrom(['2026-08-20','2026-08-21','2026-08-22'], TODAY)).toBe(3);
    expect(currentStreakFrom(['2026-08-21','2026-08-22'], TODAY)).toBe(2);
    // A miss YESTERDAY does break it even if earlier days exist.
    expect(currentStreakFrom(['2026-08-20','2026-08-21'], TODAY)).toBe(0);
  });

  it('report streaks reflect both current and longest', () => {
    const report = buildBehaviorReport({
      habit: DAILY_HABIT,
      completions: run(TODAY, 12),
      todayKey: TODAY,
    });
    expect(report.streaks.current).toBe(12);
    expect(report.streaks.longest).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// Day-of-week patterns
// ---------------------------------------------------------------------------

describe('behavior analytics — weekday patterns', () => {
  it('detects Thursday as the weak day with sufficient contrast', () => {
    // Build a 28-day history: strong everywhere except Thursdays.
    const completions: CompletionFact[] = [];
    for (let i = 27; i >= 0; i--) {
      const d = new Date(`${TODAY}T12:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      const wd = d.getUTCDay(); // 4 = Thursday
      const done = wd !== 4 || i === 3; // every Thursday fails except one
      completions.push({ date: key, status: done, value: 1, kind: 'FULL' });
    }
    const series = buildDaySeries(DAILY_HABIT, TODAY, 28, completions);
    const stats = weekdayStats(series);
    const thursday = stats.find((s) => s.day === 'Thu')!;
    expect(thursday.scheduled).toBeGreaterThanOrEqual(3);
    expect(thursday.rate!).toBeLessThan(0.5);
    expect(thursday.completed).toBeLessThan(thursday.scheduled);

    const patterns = detectWeekdayPatterns(stats);
    expect(patterns.worstDay?.day).toBe('Thu');
    expect(patterns.weekdayRisk).toMatchObject({ type: 'WEEKDAY_RISK', dayFull: 'Thursday' });
  });

  it('does not flag a weak weekday when everything is uniformly weak', () => {
    const completions: CompletionFact[] = Array.from({ length: 28 }, (_, i) => {
      const d = new Date(`${TODAY}T12:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() - i);
      return { date: d.toISOString().slice(0, 10), status: i % 2 === 0, value: 1, kind: 'FULL' as const };
    });
    const series = buildDaySeries(DAILY_HABIT, TODAY, 28, completions);
    const patterns = detectWeekdayPatterns(weekdayStats(series));
    expect(patterns.weekdayRisk).toBeNull();
  });

  it('returns null best/worst days below the minimum sample', () => {
    const series = buildDaySeries(DAILY_HABIT, TODAY, 3, run(TODAY, 2));
    const patterns = detectWeekdayPatterns(weekdayStats(series));
    expect(patterns.bestDay).toBeNull();
    expect(patterns.worstDay).toBeNull();
  });

  it('surfaces WEEKDAY_RISK in the structured signals of a full report', () => {
    const completions: CompletionFact[] = [];
    for (let i = 89; i >= 0; i--) {
      const d = new Date(`${TODAY}T12:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() - i);
      const wd = d.getUTCDay();
      completions.push({
        date: d.toISOString().slice(0, 10),
        status: wd !== 4 ? true : i % 3 === 0,
        value: 1,
        kind: 'FULL',
      });
    }
    const report = buildBehaviorReport({
      habit: DAILY_HABIT,
      completions,
      todayKey: TODAY,
    });
    const risk = report.structuredSignals.find((s) => s.type === 'WEEKDAY_RISK');
    expect(risk).toBeDefined();
    expect((risk as any).day).toBe('THURSDAY');
    expect(report.worstDayOfWeek).toBe('Thursday');
    expect(report.risk.reasons.some((r) => r.includes('Thursday'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Time windows & timezone handling
// ---------------------------------------------------------------------------

describe('behavior analytics — time windows', () => {
  it('buckets hours into the configured windows incl. midnight wrap', () => {
    expect(bucketCodeForHhmm('06:15')).toBe('EARLY_MORNING');
    expect(bucketCodeForHhmm('09:00')).toBe('MORNING');
    expect(bucketCodeForHhmm('13:40')).toBe('AFTERNOON');
    expect(bucketCodeForHhmm('18:05')).toBe('EVENING');
    expect(bucketCodeForHhmm('22:30')).toBe('NIGHT');
    expect(bucketCodeForHhmm('03:10')).toBe('NIGHT');
    expect(bucketCodeForHhmm('04:59')).toBe('NIGHT');
    expect(bucketCodeForHhmm('05:00')).toBe('EARLY_MORNING');
  });

  it('converts instants using the user timezone and reports it', () => {
    // 21:30 UTC on Aug 22 == 02:30 PKT on Aug 23 (+05:00).
    const z = zonedHhmm('2026-08-22T21:30:00.000Z', 'Asia/Karachi');
    expect(z.timezoneUsed).toBe('Asia/Karachi');
    expect(z.hhmm).toBe('02:30');

    const utc = zonedHhmm('2026-08-22T21:30:00.000Z', null);
    expect(utc.timezoneUsed).toBe('UTC');
    expect(utc.hhmm).toBe('21:30');
  });

  it('falls back to UTC on an invalid timezone instead of crashing', () => {
    const z = zonedHhmm('2026-08-22T09:00:00.000Z', 'Not/AZone');
    expect(z.timezoneUsed).toBe('UTC');
    expect(z.hhmm).toBe('09:00');
  });

  it('reports no best/worst window below the minimum sample size', () => {
    const completions: CompletionFact[] = run(TODAY, 3).map((c, i) => ({
      ...c,
      createdAt: `2026-08-${20 + i}T07:00:00.000Z`,
    }));
    const report = buildBehaviorReport({
      habit: DAILY_HABIT,
      completions,
      todayKey: TODAY,
    });
    expect(report.timeWindows.sampleSize).toBe(3);
    expect(report.timeWindows.best).toBeNull();
    expect(report.timeWindows.worst).toBeNull();
  });

  it('identifies best and worst windows once enough samples exist', () => {
    const completions: CompletionFact[] = [];
    // 6 morning completions + 1 late-night completion over distinct days.
    for (let i = 0; i < 7; i++) {
      const day = String(16 + i).padStart(2, '0');
      completions.push({
        date: `2026-08-${day}`,
        status: true,
        value: 1,
        kind: 'FULL',
        createdAt:
          i < 6 ? `2026-08-${day}T07:30:00.000Z` : `2026-08-${day}T23:30:00.000Z`,
      });
    }
    const report = buildBehaviorReport({
      habit: DAILY_HABIT,
      completions,
      todayKey: TODAY,
    });
    expect(report.timeWindows.sampleSize).toBe(7);
    expect(report.timeWindows.best?.code).toBe('EARLY_MORNING');
    expect(report.timeWindows.worst?.code).toBe('NIGHT');
  });
});

// ---------------------------------------------------------------------------
// Risk score
// ---------------------------------------------------------------------------

describe('behavior analytics — risk score', () => {
  const base = {
    missRate7: 0,
    rate7: 1,
    rate30: 1,
    missRate30: 0,
    missed7: 0,
    expected7: 7,
    missed30: 0,
    expected30: 30,
    minimumCount7: 0,
    completionsCount7: 7,
    emergencyCount7: 0,
    weekdayRisk: null,
  };

  it('perfect consistency maps to LOW with no reasons', () => {
    const risk = computeRiskScore(base);
    expect(risk.score).toBe(0);
    expect(risk.level).toBe('LOW');
    expect(risk.reasons).toEqual([]);
  });

  it('level bands follow the centralized weighted model', () => {
    // A single factor can never exceed its weight (they sum to 1): a fully
    // missed recent week tops out at 0.30 -> exactly MODERATE.
    expect(computeRiskScore({ ...base, missRate7: RISK_LEVEL_BOUNDS.MODERATE - 0.01 }).level).toBe('LOW');
    expect(computeRiskScore({ ...base, missRate7: 1 }).level).toBe('MODERATE');

    // Stacking factors crosses each band boundary deterministically.
    const twoFactors = computeRiskScore({
      ...base, missRate7: 1, missRate30: 1, missed7: 7, missed30: 30,
    });
    expect(twoFactors.score).toBeCloseTo(RISK_WEIGHTS.recentMissRate + RISK_WEIGHTS.baselineMissRate);
    expect(twoFactors.level).toBe('MODERATE');

    const heavyFactors = {
      ...base, missRate7: 1, missRate30: 1, missed7: 7, missed30: 30,
      minimumCount7: 7, emergencyCount7: 7, completionsCount7: 7,
    };
    expect(computeRiskScore(heavyFactors).level).toBe('HIGH');

    const fiveFactors = computeRiskScore({
      ...heavyFactors,
      weekdayRisk: { dayFull: 'Thursday', completionRate: 0 },
    });
    expect(fiveFactors.level).toBe('CRITICAL');
    expect(fiveFactors.score).toBeCloseTo(
      RISK_WEIGHTS.recentMissRate +
        RISK_WEIGHTS.baselineMissRate +
        RISK_WEIGHTS.minimumUsage +
        RISK_WEIGHTS.emergencyUsage +
        RISK_WEIGHTS.weekdayWeakness,
    );
  });

  it('produces explainable reasons containing the real numbers', () => {
    const risk = computeRiskScore({
      ...base,
      missRate7: 3 / 7,
      missed7: 3,
      rate7: 4 / 7,
      rate30: 0.9,
      minimumCount7: 2,
      completionsCount7: 4,
      emergencyCount7: 1,
    });
    expect(risk.reasons).toContain('3 of 7 scheduled days missed in the last 7 days');
    expect(risk.reasons.some((r) => r.startsWith('completion rate fell to'))).toBe(true);
    expect(risk.reasons).toContain('minimum version used for 2 of the last 4 completions');
    expect(risk.reasons).toContain('emergency version used 1 time(s) in the last 7 days');
    // Weighted sum lands in the MODERATE band for this factor mix.
    expect(risk.level).toBe('MODERATE');
  });

  it('never exceeds 1.00 even under catastrophic input', () => {
    const risk = computeRiskScore({
      ...base,
      missRate7: 1,
      missRate30: 1,
      rate7: 0,
      rate30: 1,
      missed7: 7,
      missed30: 30,
      minimumCount7: 7,
      completionsCount7: 7,
      emergencyCount7: 7,
      weekdayRisk: { dayFull: 'Thursday', completionRate: 0 },
    });
    expect(risk.score).toBeLessThanOrEqual(1);
    expect(risk.level).toBe('CRITICAL');
  });
});

// ---------------------------------------------------------------------------
// Momentum
// ---------------------------------------------------------------------------

describe('behavior analytics — momentum', () => {
  it('is null without enough history', () => {
    expect(computeMomentum({
      rate7: null, ratePrev7: null, currentStreak: 0, longestStreak: 0,
      evidenceRecent7: 0, evidencePrev7: 0,
    })).toEqual({ score: null, level: null });
  });

  it('strong recent week with growth scores STRONG; fading week scores FADING', () => {
    const strong = computeMomentum({
      rate7: 1, ratePrev7: 0.85, currentStreak: 14, longestStreak: 14,
      evidenceRecent7: 14, evidencePrev7: 10,
    });
    expect(strong.level).toBe('STRONG');

    const fading = computeMomentum({
      rate7: 0.2, ratePrev7: 0.9, currentStreak: 0, longestStreak: 10,
      evidenceRecent7: 2, evidencePrev7: 12,
    });
    expect(fading.level).toBe('FADING');
    expect(fading.score!).toBeLessThan(strong.score!);
  });

  it('risk and momentum move independently (MODERATE risk, STRONG momentum)', () => {
    // A solid, improving recent week (momentum up) that still leans heavily
    // on the minimum version after a shaky month (risk elevated).
    const momentum = computeMomentum({
      rate7: 0.86, ratePrev7: 0.5, currentStreak: 10, longestStreak: 14,
      evidenceRecent7: 14, evidencePrev7: 8,
    });
    const risk = computeRiskScore({
      missRate7: 0.2, rate7: 0.86, rate30: 0.7, missRate30: 0.5,
      missed7: 1, expected7: 5, missed30: 14, expected30: 28,
      minimumCount7: 7, completionsCount7: 7, emergencyCount7: 0,
      weekdayRisk: { dayFull: 'Thursday', completionRate: 0.2 },
    });
    expect(risk.level).toBe('MODERATE');
    expect(momentum.level).toBe('STRONG');
  });
});

// ---------------------------------------------------------------------------
// Difficulty detection
// ---------------------------------------------------------------------------

describe('behavior analytics — difficulty detection', () => {
  it('fires TOO_HARD with cumulative confidence under heavy reduced usage', () => {
    const verdict = detectDifficulty({
      minimumShare7: 0.5,
      emergencyCount7: 2,
      emergencyShare30: 0.2,
      declineMagnitude: 0.25,
      fullIsMajorityOutcome30: false,
    });
    expect(verdict).not.toBeNull();
    expect(verdict!.signal).toBe('TOO_HARD');
    expect(verdict!.confidence).toBeGreaterThanOrEqual(0.9);
    expect(verdict!.reasons.length).toBeGreaterThanOrEqual(4);
  });

  it('stays silent when evidence is thin', () => {
    expect(detectDifficulty({
      minimumShare7: 0.1, emergencyCount7: 0, emergencyShare30: 0.02,
      declineMagnitude: 0.05, fullIsMajorityOutcome30: true,
    })).toBeNull();
  });

  it('minimum-only history triggers the difficulty signal in a full report', () => {
    const completions = [
      ...run('2026-08-23', 5, 'MINIMUM'), // Aug 19-23: barely showing up
      { date: '2026-08-18', status: true, value: 20, kind: 'EMERGENCY' as const },
      ...run('2026-08-17', 7, 'FULL'), // prior week: full versions
    ];
    const report = buildBehaviorReport({
      habit: DAILY_HABIT,
      completions,
      todayKey: TODAY,
    });
    expect(report.signals).toContain('TOO_HARD');
    const sig = report.structuredSignals.find((s) => s.type === 'DIFFICULTY_TOO_HIGH');
    expect((sig as any).confidence).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Signal thresholds (recovery / consistent / declining)
// ---------------------------------------------------------------------------

describe('behavior analytics — signal derivation', () => {
  it('marks RECOVERING after a bad week followed by a much better one', () => {
    // Previous week ~17% (one of six), recent week perfect.
    const completions: CompletionFact[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(`${TODAY}T12:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      const inRecentWeek = i <= 6;
      completions.push({ date: key, status: inRecentWeek, value: 1, kind: 'FULL' });
    }
    const report = buildBehaviorReport({
      habit: DAILY_HABIT,
      completions,
      todayKey: TODAY,
    });
    expect(report.previousWeekRate).not.toBeNull();
    expect(report.previousWeekRate!).toBeLessThanOrEqual(SIGNAL_THRESHOLDS.RECOVERY_FLOOR);
    expect(report.signals).toContain('RECOVERING');
  });

  it('marks CONSISTENT for high 30d rate plus a live streak', () => {
    const report = buildBehaviorReport({
      habit: DAILY_HABIT,
      completions: run(TODAY, 30),
      todayKey: TODAY,
    });
    expect(report.signals).toContain('CONSISTENT');
    expect(report.signals).toContain('STRONG_MOMENTUM');
    expect(report.momentum.level).toBe('STRONG');
  });

  it('marks DECLINING when the recent week drops well below the month', () => {
    const completions: CompletionFact[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(`${TODAY}T12:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      const inRecentWeek = i <= 6;
      completions.push({ date: key, status: !inRecentWeek, value: 1, kind: 'FULL' });
    }
    const report = buildBehaviorReport({
      habit: DAILY_HABIT,
      completions,
      todayKey: TODAY,
    });
    expect(report.signals).toContain('DECLINING');
    expect(report.signals).toContain('AT_RISK');
  });
});
