/**
 * Phase 4.2 — pure effectiveness/funnel measurement utilities.
 *
 * NO database, NO AI, NO side effects. All rates carry EXPLICIT correct
 * denominators; the privacy floor suppresses any rate whose numerator OR
 * denominator is below MIN_AGGREGATE_SAMPLE (spec §9).
 */

import {
  MIN_AGGREGATE_SAMPLE,
  SUPPRESSED_REASON,
} from './admin/admin.constants';

export type MeasurementConfidence =
  | 'HIGH'
  | 'MEDIUM'
  | 'LOW'
  | 'INSUFFICIENT_DATA';

/** Evidence-quality thresholds (sample size → confidence). */
export const MEASUREMENT_CONFIDENCE_THRESHOLDS = {
  HIGH: 20,
  MEDIUM: 10,
  LOW: 5,
} as const;

export interface RateResult {
  suppressed: boolean;
  reason?: typeof SUPPRESSED_REASON;
  rate?: number;
  numerator: number;
  denominator: number;
  /** Documents which funnel stage each side came from — no hidden math. */
  label?: string;
}

/**
 * Explicit-denominator rate. Suppressed when EITHER side is below the
 * privacy floor or the denominator is zero. Never fabricates a ratio.
 */
export const calculateRate = (
  numerator: number,
  denominator: number,
  label?: string,
): RateResult => ({
  numerator,
  denominator,
  ...(label ? { label } : {}),
  ...(denominator < MIN_AGGREGATE_SAMPLE ||
  numerator < MIN_AGGREGATE_SAMPLE ||
  denominator === 0
    ? { suppressed: true, reason: SUPPRESSED_REASON }
    : { suppressed: false, rate: Number((numerator / denominator).toFixed(4)) }),
});

/** Evidence-quality classification from an evaluated sample size. */
export const calculateConfidence = (
  evaluatedSample: number,
): MeasurementConfidence => {
  if (evaluatedSample < MEASUREMENT_CONFIDENCE_THRESHOLDS.LOW) {
    return 'INSUFFICIENT_DATA';
  }
  if (evaluatedSample >= MEASUREMENT_CONFIDENCE_THRESHOLDS.HIGH) return 'HIGH';
  if (evaluatedSample >= MEASUREMENT_CONFIDENCE_THRESHOLDS.MEDIUM) {
    return 'MEDIUM';
  }
  return 'LOW';
};

export interface FunnelStageInput {
  label: string;
  count: number;
}

export interface FunnelStageResult extends FunnelStageInput {
  suppressed: boolean;
  reason?: typeof SUPPRESSED_REASON;
  /** Conversion from the PREVIOUS stage — explicit pairwise denominator. */
  stepRate?: number;
}

/**
 * Pairwise step-conversion funnel: stepRate[i] = count[i] / count[i-1].
 * The first stage has no step rate (it IS the denominator baseline).
 */
export const calculateFunnel = (
  stages: FunnelStageInput[],
): FunnelStageResult[] =>
  stages.map((stage, i) => {
    if (stage.count < MIN_AGGREGATE_SAMPLE) {
      return { ...stage, suppressed: true, reason: SUPPRESSED_REASON };
    }
    if (i === 0) return { ...stage, suppressed: false };
    const prev = stages[i - 1].count;
    const rate = calculateRate(stage.count, prev, `${stage.label}/${stages[i - 1].label}`);
    if (rate.suppressed) {
      return { ...stage, suppressed: true, reason: rate.reason };
    }
    return { ...stage, suppressed: false, stepRate: rate.rate };
  });

export type PrivacyFloored<T> =
  | T
  | { suppressed: true; reason: typeof SUPPRESSED_REASON };

/** Single-value privacy floor wrapper (Phase 3.8 semantics preserved). */
export const applyPrivacyFloor = <T extends number>(count: T) =>
  count >= MIN_AGGREGATE_SAMPLE
    ? count
    : ({ suppressed: true, reason: SUPPRESSED_REASON } as const);
