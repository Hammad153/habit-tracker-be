import { MAX_IDENTITY_LEVEL } from './evidence.constants';

/**
 * Identity evidence scoring — deterministic and explainable.
 *
 * Points per completion kind:
 *   FULL       = 2  (the full promised behavior)
 *   MINIMUM    = 1  (the 2-minute version; consistency preserved)
 *   EMERGENCY  = 1  (reduced version used on hard days)
 *
 * Levels are thresholds over accumulated points. A level is never lost:
 * evidence is derived from historical completions, so it only grows while
 * history exists.
 */
export const EVIDENCE_POINTS: Record<
  'FULL' | 'MINIMUM' | 'EMERGENCY',
  number
> = {
  FULL: 2,
  MINIMUM: 1,
  EMERGENCY: 1,
};

/**
 * Cumulative point thresholds required to reach each identity level.
 * Index 0 is Level 1 (0 points). The array must have MAX_IDENTITY_LEVEL
 * entries.
 */
export const IDENTITY_LEVEL_THRESHOLDS = [0, 15, 50, 125, 250];

export const IDENTITY_LEVEL_TITLES = [
  'Starting',
  'Showing Up',
  'Consistent',
  'Reliable',
  'Established',
];

export interface EvidenceKindCounts {
  FULL: number;
  MINIMUM: number;
  EMERGENCY: number;
}

export const calculateEvidencePoints = (
  counts: Partial<EvidenceKindCounts>,
): number =>
  (counts.FULL ?? 0) * EVIDENCE_POINTS.FULL +
  (counts.MINIMUM ?? 0) * EVIDENCE_POINTS.MINIMUM +
  (counts.EMERGENCY ?? 0) * EVIDENCE_POINTS.EMERGENCY;

export interface IdentityLevelInfo {
  level: number;
  /** Named stage of the identity ladder, e.g. "Consistent". */
  levelTitle: string;
  points: number;
  nextLevelThreshold: number | null;
  pointsToNextLevel: number;
  /** Progress toward the NEXT level, 0-100. Null at max level. */
  progressToNextLevel: number | null;
}

/**
 * Explains exactly how much evidence the identity has and what separates it
 * from the next level:
 *   numerator   = points earned since the previous threshold
 *   denominator = size of the current level's threshold band
 */
export const calculateIdentityLevel = (
  points: number,
): IdentityLevelInfo => {
  let level = 1;
  for (let i = MAX_IDENTITY_LEVEL - 1; i >= 0; i--) {
    if (points >= IDENTITY_LEVEL_THRESHOLDS[i]) {
      level = i + 1;
      break;
    }
  }

  if (level >= MAX_IDENTITY_LEVEL) {
    return {
      level,
      levelTitle: IDENTITY_LEVEL_TITLES[level - 1],
      points,
      nextLevelThreshold: null,
      pointsToNextLevel: 0,
      progressToNextLevel: null,
    };
  }

  const currentThreshold = IDENTITY_LEVEL_THRESHOLDS[level - 1];
  const nextThreshold = IDENTITY_LEVEL_THRESHOLDS[level];
  const bandSize = nextThreshold - currentThreshold;
  const earnedInBand = points - currentThreshold;

  return {
    level,
    levelTitle: IDENTITY_LEVEL_TITLES[level - 1],
    points,
    nextLevelThreshold: nextThreshold,
    pointsToNextLevel: Math.max(nextThreshold - points, 0),
    progressToNextLevel: Math.min(
      Math.round((earnedInBand / bandSize) * 100),
      100,
    ),
  };
};
