import {
  aggregateEffectivenessByType,
  buildTuningInsights,
} from './adaptation-effectiveness.utils';

const row = (type: string, outcome: 'IMPROVED' | 'WORSENED' | 'UNCHANGED' | 'INSUFFICIENT_DATA') => ({
  type,
  outcome,
});

describe('adaptation effectiveness — measurement, not mutation', () => {
  it('below minimum sample → INSUFFICIENT_EVIDENCE verdict with null rates', () => {
    const rows = Array.from({ length: 9 }, (_, i) =>
      row('REDUCE_TARGET', i % 2 ? 'IMPROVED' : 'UNCHANGED'),
    );
    const [r] = aggregateEffectivenessByType(rows);
    expect(r.evaluated).toBe(9);
    expect(r.verdict).toBe('INSUFFICIENT_EVIDENCE');
    expect(r.improvementRate).toBeCloseTo(4 / 9, 4);
  });

  it('at threshold sample classifies EFFECTIVE / HARMFUL / MIXED', () => {
    const effective = [
      ...Array.from({ length: 7 }, () => row('REDUCE_TARGET', 'IMPROVED')),
      ...Array.from({ length: 3 }, () => row('REDUCE_TARGET', 'UNCHANGED')),
    ];
    expect(aggregateEffectivenessByType(effective)[0].verdict).toBe('EFFECTIVE');

    const harmful = [
      ...Array.from({ length: 6 }, () => row('CHANGE_TIME', 'WORSENED')),
      ...Array.from({ length: 2 }, () => row('CHANGE_TIME', 'IMPROVED')),
      ...Array.from({ length: 2 }, () => row('CHANGE_TIME', 'UNCHANGED')),
    ];
    expect(aggregateEffectivenessByType(harmful)[0].verdict).toBe('HARMFUL');

    const mixed = [
      ...Array.from({ length: 5 }, () => row('REDUCE_FREQUENCY', 'IMPROVED')),
      ...Array.from({ length: 5 }, () => row('REDUCE_FREQUENCY', 'WORSENED')),
    ];
    const [r] = aggregateEffectivenessByType(mixed);
    expect(r.verdict).toBe('MIXED');
    expect(r.improvementRate).toBe(0.5);
  });

  it('counts insufficient-data separately without affecting evaluated math', () => {
    const rows = [
      ...Array.from({ length: 10 }, () => row('REDUCE_TARGET', 'IMPROVED')),
      ...Array.from({ length: 3 }, () => row('REDUCE_TARGET', 'INSUFFICIENT_DATA')),
    ];
    const r = aggregateEffectivenessByType(rows)[0];
    expect(r.improvementRate).toBe(1); // evaluated denominator only
    expect(r.insufficientData).toBe(3);
  });

  it('aggregates per proposal type and includes accepted counts', () => {
    const rows = [
      ...Array.from({ length: 12 }, () => row('REDUCE_TARGET', 'IMPROVED')),
      ...Array.from({ length: 11 }, () => row('CHANGE_TIME', 'UNCHANGED')),
    ];
    const res = aggregateEffectivenessByType(rows, [
      'REDUCE_TARGET',
      'REDUCE_TARGET',
      'CHANGE_TIME',
      'NEVER_SEEN_TYPE',
    ]);
    const byType = Object.fromEntries(res.map((r) => [r.type, r]));
    expect(byType.REDUCE_TARGET.accepted).toBe(2);
    expect(byType.CHANGE_TIME.accepted).toBe(1);
    expect(byType.NEVER_SEEN_TYPE.verdict).toBe('INSUFFICIENT_EVIDENCE');
    expect(res[0].type).toBe('REDUCE_TARGET'); // sorted by evaluated desc
  });

  it('tuning insights cite real numbers and skip thin evidence types', () => {
    const rows = [
      ...Array.from({ length: 22 }, (_, i) =>
        row('REDUCE_TARGET', i < 15 ? 'IMPROVED' : 'UNCHANGED'),
      ),
      ...Array.from({ length: 4 }, () => row('CHANGE_TIME', 'IMPROVED')),
    ];
    const insights = buildTuningInsights(
      aggregateEffectivenessByType(rows),
    );
    const rt = insights.find((i) => i.type === 'REDUCE_TARGET');
    expect(rt?.message).toContain('68%'); // 15/22
    expect(rt?.message).toContain('evaluated proposals improved');
    expect(insights.find((i) => i.type === 'CHANGE_TIME')).toBeUndefined();
  });
});
