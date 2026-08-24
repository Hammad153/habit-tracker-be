import {
  calculateConfidence,
  calculateFunnel,
  calculateRate,
} from './effectiveness.utils';

describe('calculateRate — explicit denominators & privacy floor (spec §9)', () => {
  it('normal funnel rate with documented sides', () => {
    const r = calculateRate(20, 25, 'viewed/generated');
    expect(r).toMatchObject({
      suppressed: false, rate: 0.8,
      numerator: 20, denominator: 25, label: 'viewed/generated',
    });
  });

  it('zero denominator → suppressed (never NaN/Infinity)', () => {
    expect(calculateRate(0, 0).suppressed).toBe(true);
  });

  it('suppressed numerator (< floor)', () => {
    expect(calculateRate(3, 25).suppressed).toBe(true);
  });

  it('suppressed denominator (< floor) — even with a big numerator', () => {
    // Never expose 20/4-style ratios from tiny cohorts:
    const r = calculateRate(20, 4);
    expect(r.suppressed).toBe(true);
    expect(r.rate).toBeUndefined();
  });

  it('boundary: numerator AND denominator exactly at the floor pass', () => {
    expect(calculateRate(5, 5).rate).toBe(1);
  });
});

describe('calculateFunnel — pairwise explicit denominators', () => {
  it('normal funnel: each stepRate uses the previous stage', () => {
    const stages = calculateFunnel([
      { label: 'candidates', count: 40 },
      { label: 'delivered', count: 30 },
      { label: 'opened', count: 15 },
      { label: 'actionStarted', count: 9 },
      { label: 'actionCompleted', count: 6 },
    ]);
    expect(stages.map((s) => s.stepRate)).toEqual([
      undefined, 0.75, 0.5, Number((6 / 9).toFixed(4)),
    ]);
    expect(stages.every((s) => !s.suppressed)).toBe(true);
  });

  it('a suppressed middle stage suppresses downstream step rates', () => {
    const stages = calculateFunnel([
      { label: 'candidates', count: 30 },
      { label: 'delivered', count: 3 }, // below floor
      { label: 'opened', count: 2 },
    ]);
    expect(stages[1].suppressed).toBe(true);
    expect(stages[1].stepRate).toBeUndefined();
    // opened=2 is itself below floor too:
    expect(stages[2].suppressed).toBe(true);
  });

  it('missing/incomplete funnels never fabricate rates', () => {
    const stages = calculateFunnel([
      { label: 'generated', count: 10 },
      { label: 'viewed', count: 0 },
      { label: 'acted', count: 0 },
    ]);
    // viewed/generated fine (0/10 → but numerator below floor → suppressed):
    expect(stages[1].suppressed).toBe(true);
    expect(stages[2].stepRate).toBeUndefined();
  });
});

describe('calculateConfidence — evidence-quality thresholds', () => {
  it.each([
    [0, 'INSUFFICIENT_DATA'],
    [4, 'INSUFFICIENT_DATA'],
    [5, 'LOW'],
    [9, 'LOW'],
    [10, 'MEDIUM'],
    [19, 'MEDIUM'],
    [20, 'HIGH'],
    [200, 'HIGH'],
  ])('%i evaluated → %s', (n, expected) => {
    expect(calculateConfidence(n)).toBe(expected);
  });
});
