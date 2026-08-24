import {
  HabitLoadSummary,
  buildPortfolioOverloadReport,
  contributionScore,
  identityAnchors,
} from './portfolio-overload.engine';

const summary = (over: Partial<HabitLoadSummary> & { habitId: string }): HabitLoadSummary => ({
  title: over.title ?? over.habitId,
  completionRate30: 0.4,
  missRate30: 0.6,
  riskLevel: 'HIGH',
  riskScore: 0.7,
  momentumLevel: 'FADING',
  signals: ['TOO_HARD'],
  streakCurrent: 0,
  streakLongest: 9,
  reducedKindShare: 0.6,
  identityTitles: [],
  ...over,
});

/** Five struggling habits + two healthy ones → classic overload shape. */
const overloadedSet = (): HabitLoadSummary[] => [
  ...Array.from({ length: 5 }, (_, i) =>
    summary({ habitId: `bad-${i}`, title: `Struggling ${i + 1}` }),
  ),
  summary({ habitId: 'good-1', riskLevel: 'LOW', riskScore: 0.05, missRate30: 0.05, completionRate30: 0.95, signals: [], momentumLevel: 'STRONG', reducedKindShare: 0 }),
  summary({ habitId: 'good-2', riskLevel: 'MODERATE', riskScore: 0.35, missRate30: 0.2, completionRate30: 0.8, signals: [], momentumLevel: 'STEADY', reducedKindShare: 0.1 }),
];

describe('portfolio overload — gates', () => {
  it('fewer than 5 active habits → never overloaded', () => {
    const r = buildPortfolioOverloadReport(4, overloadedSet().slice(0, 4));
    expect(r.overloaded).toBe(false);
    expect(r.contributingFactors.join(' ')).toContain('Only 4');
  });

  it('five struggling habits with sufficient misses → OVERLOADED', () => {
    const set = overloadedSet();
    const r = buildPortfolioOverloadReport(7, set);
    expect(r.overloaded).toBe(true);
    expect(r.score).toBeGreaterThan(0);
    expect(r.highRiskHabitCount).toBe(5);
    expect(r.analyzedHabitCount).toBe(7);
    expect(r.averageMissRate30!).toBeGreaterThan(0.4);
    expect(['MEDIUM','HIGH']).toContain(r.confidence);
  });

  it('high-risk share below threshold → not overloaded even with misses', () => {
    const set = [
      summary({ habitId: 'a', riskLevel: 'MODERATE', riskScore: 0.4, missRate30: 0.7, completionRate30: 0.3 }),
      summary({ habitId: 'b', riskLevel: 'LOW', riskScore: 0.1, missRate30: 0.7, completionRate30: 0.3, signals: [] }),
      summary({ habitId: 'c', riskLevel: 'LOW', riskScore: 0.1, missRate30: 0.7, completionRate30: 0.3, signals: [] }),
      summary({ habitId: 'd', riskLevel: 'LOW', riskScore: 0.1, missRate30: 0.7, completionRate30: 0.3, signals: [] }),
      summary({ habitId: 'e', riskLevel: 'MODERATE', riskScore: 0.4, missRate30: 0.7, completionRate30: 0.3 }),
    ];
    const r = buildPortfolioOverloadReport(5, set);
    expect(r.overloaded).toBe(false);
  });

  it('average miss rate below threshold → not overloaded despite high risk share', () => {
    const set = Array.from({ length: 5 }, (_, i) =>
      summary({
        habitId: `ok-${i}`,
        riskLevel: 'HIGH',
        riskScore: 0.65,
        missRate30: 0.15,
        completionRate30: 0.85,
        signals: [],
        momentumLevel: 'STEADY',
        reducedKindShare: 0,
      }),
    );
    const r = buildPortfolioOverloadReport(5, set);
    expect(r.overloaded).toBe(false);
  });

  it('insufficient analytics coverage → conservative result', () => {
    // Only 1 of 6 habits analyzable (<50% analyzed).
    const r = buildPortfolioOverloadReport(6, [summary({ habitId: 'only-one' })]);
    expect(r.overloaded).toBe(false);
    expect(r.analyzedHabitCount).toBe(1);
    expect(r.confidence).toBe('LOW');
  });
});

describe('portfolio overload — contribution & identity prioritization', () => {
  it('contribution score ranks heavier habits first and cites real values', () => {
    const r = buildPortfolioOverloadReport(7, overloadedSet());
    expect(r.contributors.length).toBeGreaterThan(0);
    for (const c of r.contributors) {
      expect(c.factor).toMatch(/\d+% /);
    }
    // Scores are descending among non-anchors.
    const scores = r.contributors.filter((c) => !c.isIdentityAnchor).map((c) => c.contributionScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('identity anchors are protected: weaker sibling ranks first', () => {
    const set = [
      summary({ habitId: 'anchor', title: 'Morning run', identityTitles: ['Runner'], completionRate30: 0.95, missRate30: 0.05, riskLevel: 'LOW', riskScore: 0.05, signals: [], momentumLevel: 'STRONG', streakCurrent: 20, reducedKindShare: 0 }),
      summary({ habitId: 'weak', title: 'Evening run', identityTitles: ['Runner'], missRate30: 0.7, riskLevel: 'CRITICAL', riskScore: 0.85 }),
      summary({ habitId: 'x', missRate30: 0.65, riskLevel: 'HIGH', riskScore: 0.7 }),
      summary({ habitId: 'y', missRate30: 0.65, riskLevel: 'HIGH', riskScore: 0.7 }),
      summary({ habitId: 'z', missRate30: 0.65, riskLevel: 'HIGH', riskScore: 0.7 }),
    ];
    const anchors = identityAnchors(set);
    expect(anchors.has('anchor')).toBe(true);
    const r = buildPortfolioOverloadReport(5, set);
    const anchorEntry = r.contributors.find((c) => c.title === 'Morning run');
    const weakEntry = r.contributors.find((c) => c.title === 'Evening run');
    expect(anchorEntry?.isIdentityAnchor).toBe(true);
    if (weakEntry && anchorEntry) {
      expect(r.contributors.indexOf(weakEntry!)).toBeLessThan(r.contributors.indexOf(anchorEntry!));
    }
  });

  it('solo identities produce no artificial anchors', () => {
    const set = [summary({ habitId: 'a', identityTitles: ['Reader'] })];
    expect(identityAnchors(set).size).toBe(0);
  });

  it('deterministic: identical inputs → identical reports; inputs unmutated', () => {
    const set = overloadedSet();
    const snap = JSON.stringify(set);
    const a = buildPortfolioOverloadReport(7, set);
    const b = buildPortfolioOverloadReport(7, set);
    expect(a).toEqual(b);
    expect(JSON.stringify(set)).toBe(snap);
  });

  it('contributionScore is bounded and uses documented weights direction', () => {
    const heavy = summary({ habitId: 'heavy', riskScore: 1, missRate30: 1, signals: ['TOO_HARD', 'DECLINING'], momentumLevel: 'FADING', reducedKindShare: 1, streakLongest: 10, streakCurrent: 0 });
    const light = summary({ habitId: 'light', riskScore: 0, missRate30: 0, signals: [], momentumLevel: 'STRONG', reducedKindShare: 0, streakCurrent: 10, streakLongest: 10, riskLevel: 'LOW' });
    expect(contributionScore(heavy)).toBeCloseTo(1, 1);
    expect(contributionScore(light)).toBeLessThan(0.1);
  });
});
