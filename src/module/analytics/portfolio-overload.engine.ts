import {
  LOAD_CONTRIBUTION_WEIGHTS,
  OVERLOAD_THRESHOLDS,
} from '../../core/utils/behavior.constants';
import { RISK_BAND_ORDER } from '../../core/utils/adaptive.constants';

/**
 * Phase 3.6 — deterministic portfolio-level overload report.
 *
 * Pure: identical habit summaries always produce an identical report.
 * No IO, no AI. Every number in contributing factors is real.
 */

export interface HabitLoadSummary {
  /** Internal id — used for ranking only, never exposed by the API layer. */
  habitId: string;
  title: string;
  completionRate30: number | null;
  missRate30: number | null;
  riskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' | null;
  riskScore: number | null;
  momentumLevel: 'STRONG' | 'STEADY' | 'FADING' | null;
  signals: string[];
  streakCurrent: number;
  streakLongest: number;
  reducedKindShare: number; // minimum+emergency share of 30d completions
  identityTitles: string[];
}

export interface HabitContribution {
  title: string;
  identityTitles: string[];
  contributionScore: number;
  missRate30: number | null;
  riskLevel: HabitLoadSummary['riskLevel'];
  isIdentityAnchor: boolean;
  factor: string;
}

export interface PortfolioOverloadReport {
  overloaded: boolean;
  score: number;
  activeHabitCount: number;
  analyzedHabitCount: number;
  atRiskHabitCount: number;
  highRiskHabitCount: number;
  averageMissRate30: number | null;
  averageCompletionRate30: number | null;
  contributors: HabitContribution[];
  contributingFactors: string[];
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
}

const round2 = (v: number): number => Number(v.toFixed(2));
const pct = (v: number): string => `${Math.round(v * 100)}%`;

const riskIndex = (level: HabitLoadSummary['riskLevel']): number =>
  level ? RISK_BAND_ORDER.indexOf(level) : -1;

/**
 * Deterministic load-contribution score in [0,1] using centralized weights.
 * Higher = heavier contributor to portfolio overload.
 */
export const contributionScore = (h: HabitLoadSummary): number => {
  const w = LOAD_CONTRIBUTION_WEIGHTS;
  const parts = {
    riskScore: (h.riskScore ?? 0) / Math.max(1, w.riskScore * 0 + 1), // normalized below
  };
  void parts;
  const components: Array<[number, number]> = [
    [h.riskScore ?? 0, w.riskScore],
    [h.missRate30 ?? 0, w.missRate30],
    [h.signals.includes('TOO_HARD') ? 1 : 0, w.difficultySignal],
    [h.momentumLevel === 'FADING' || h.signals.includes('DECLINING') ? 1 : 0, w.decliningMomentum],
    [Math.min(1, h.reducedKindShare), w.reducedKindShare],
    // Instability: long past streak but broken present.
    [
      h.streakLongest >= 5 && h.streakCurrent === 0 ? 1 : h.streakCurrent === 0 ? 0.4 : 0,
      w.streakInstability,
    ],
  ];
  const raw = components.reduce((sum, [v, weight]) => sum + v * weight, 0);
  return round2(Math.min(1, raw));
};

/**
 * Identity-aware preservation ordering. Within the same identity group the
 * ANCHOR is the strongest habit (consistency + momentum + lower risk);
 * friction reduction should target non-anchor habits first.
 */
export const identityAnchors = (
  summaries: HabitLoadSummary[],
): Set<string> => {
  const byIdentity = new Map<string, HabitLoadSummary[]>();
  for (const h of summaries) {
    for (const identity of h.identityTitles) {
      const group = byIdentity.get(identity) ?? [];
      group.push(h);
      byIdentity.set(identity, group);
    }
  }
  const anchors = new Set<string>();
  const strength = (h: HabitLoadSummary): number =>
    (h.completionRate30 ?? 0) * 0.5 +
    (h.momentumLevel === 'STRONG' ? 0.25 : h.momentumLevel === 'STEADY' ? 0.1 : 0) +
    (1 - (h.riskScore ?? 0.5)) * 0.25 +
    Math.min(1, h.streakCurrent / 14) * 0.1;
  for (const [, group] of byIdentity) {
    if (group.length < 2) continue; // solo habits are trivially their own anchor
    const best = [...group].sort((a, b) => strength(b) - strength(a))[0];
    anchors.add(best.habitId);
  }
  return anchors;
};

export const buildPortfolioOverloadReport = (
  activeHabitCount: number,
  summaries: HabitLoadSummary[],
): PortfolioOverloadReport => {
  const analyzed = summaries.length;
  const withRates = summaries.filter(
    (h) => h.missRate30 !== null && h.completionRate30 !== null,
  );
  const analyzedShare =
    activeHabitCount > 0 ? analyzed / activeHabitCount : 0;

  const avgMiss =
    withRates.length > 0
      ? Number(
          (
            withRates.reduce((s, h) => s + (h.missRate30 ?? 0), 0) /
            withRates.length
          ).toFixed(4),
        )
      : null;
  const avgCompletion =
    withRates.length > 0
      ? Number(
          (
            withRates.reduce((s, h) => s + (h.completionRate30 ?? 0), 0) /
            withRates.length
          ).toFixed(4),
        )
      : null;

  const highRiskCount = summaries.filter((h) => {
    const idx = riskIndex(h.riskLevel);
    return idx >= RISK_BAND_ORDER.indexOf('HIGH');
  }).length;
  const atRiskCount = summaries.filter((h) => {
    const idx = riskIndex(h.riskLevel);
    return idx >= RISK_BAND_ORDER.indexOf('MODERATE');
  }).length;

  const gates = {
    enoughHabits: activeHabitCount >= OVERLOAD_THRESHOLDS.MIN_ACTIVE_HABITS,
    enoughAnalytics:
      analyzedShare >= OVERLOAD_THRESHOLDS.MIN_ANALYZED_SHARE &&
      analyzed > 0,
    enoughHighRisk:
      analyzed > 0 &&
      highRiskCount / analyzed >= OVERLOAD_THRESHOLDS.HIGH_RISK_SHARE,
    enoughMisses:
      avgMiss !== null && avgMiss >= OVERLOAD_THRESHOLDS.AVG_MISS_RATE_MIN,
  };
  const overloaded = Object.values(gates).every(Boolean);

  // Score blends the three severity dimensions; meaningful only when loaded.
  const score = overloaded
    ? round2(
        Math.min(
          1,
          (avgMiss ?? 0) * 0.5 +
            (analyzed > 0 ? highRiskCount / analyzed : 0) * 0.3 +
            Math.min(1, activeHabitCount / 10) * 0.2,
        ),
      )
    : 0;

  const confidence: PortfolioOverloadReport['confidence'] =
    analyzed >= 12 && analyzedShare >= 0.9
      ? 'HIGH'
      : analyzed >= 6
        ? 'MEDIUM'
        : 'LOW';

  // Contributors: heaviest first, excluding identity anchors from the top of
  // the list when a weaker sibling shares the same identity.
  const anchorSet = identityAnchors(summaries);
  const contributors: HabitContribution[] = summaries
    .map((h) => ({
      summary: h,
      score: contributionScore(h),
      anchor: anchorSet.has(h.habitId),
    }))
    .sort((a, b) => {
      if (a.anchor !== b.anchor) return a.anchor ? 1 : -1; // non-anchors first
      return b.score - a.score;
    })
    .slice(0, 5)
    .map(({ summary, score: cs, anchor }) => ({
      title: summary.title,
      identityTitles: summary.identityTitles,
      contributionScore: cs,
      missRate30: summary.missRate30,
      riskLevel: summary.riskLevel,
      isIdentityAnchor: anchor,
      factor:
        `${summary.title}: ${pct(summary.missRate30 ?? 0)} missed, ` +
        `${summary.riskLevel ?? 'unknown'} risk` +
        (anchor ? ' (identity anchor — protect)' : ''),
    }));

  const contributingFactors: string[] = [];
  if (!gates.enoughHabits) {
    contributingFactors.push(
      `Only ${activeHabitCount} active habit(s); overload needs at least ${OVERLOAD_THRESHOLDS.MIN_ACTIVE_HABITS}.`,
    );
  } else {
    if (gates.enoughHighRisk) {
      contributingFactors.push(
        `${highRiskCount} of ${analyzed} analyzed habits are HIGH or CRITICAL risk.`,
      );
    }
    if (avgMiss !== null && avgMiss >= OVERLOAD_THRESHOLDS.AVG_MISS_RATE_MIN) {
      contributingFactors.push(
        `Average 30-day miss rate across analyzed habits is ${pct(avgMiss)}.`,
      );
    }
    if (!overloaded) {
      const missing = Object.entries(gates)
        .filter(([, ok]) => !ok)
        .map(([k]) => k);
      contributingFactors.push(
        `Not overloaded yet (unmet: ${missing.join(', ') || 'none'}).`,
      );
    }
  }

  return {
    overloaded,
    score,
    activeHabitCount,
    analyzedHabitCount: analyzed,
    atRiskHabitCount: atRiskCount,
    highRiskHabitCount: highRiskCount,
    averageMissRate30: avgMiss,
    averageCompletionRate30: avgCompletion,
    contributors,
    contributingFactors,
    confidence,
  };
};
