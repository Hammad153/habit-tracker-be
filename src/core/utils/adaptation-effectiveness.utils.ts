/**
 * Phase 3.7 — adaptation effectiveness aggregation (spec §19–20).
 *
 * MEASUREMENT ONLY: this module never mutates production thresholds.
 * It produces tuning insights for developers/product owners.
 */

export const EFFECTIVENESS_THRESHOLDS = {
  /** Below this many evaluated proposals a type is INSUFFICIENT_EVIDENCE. */
  MIN_EVALUATED_SAMPLE: 10,
} as const;

export interface EffectivenessRow {
  type: string;
  outcome: 'IMPROVED' | 'WORSENED' | 'UNCHANGED' | 'INSUFFICIENT_DATA';
}

export interface TypeEffectiveness {
  type: string;
  accepted: number;
  evaluated: number;
  improved: number;
  worsened: number;
  unchanged: number;
  insufficientData: number;
  improvementRate: number | null; // improved / evaluated
  worseningRate: number | null;
  verdict: 'INSUFFICIENT_EVIDENCE' | 'EFFECTIVE' | 'MIXED' | 'HARMFUL';
}

export interface TuningInsight {
  type: string;
  message: string;
}

const round4 = (v: number): number => Number(v.toFixed(4));

export const aggregateEffectivenessByType = (
  rows: EffectivenessRow[],
  acceptedTypes: string[] = [],
): TypeEffectiveness[] => {
  const types = new Set<string>([
    ...acceptedTypes,
    ...rows.map((r) => r.type),
  ]);
  const out: TypeEffectiveness[] = [];
  for (const type of types) {
    const accepted = acceptedTypes.filter((t) => t === type).length;
    const evaluatedRows = rows.filter(
      (r) =>
        r.type === type &&
        (r.outcome === 'IMPROVED' ||
          r.outcome === 'WORSENED' ||
          r.outcome === 'UNCHANGED'),
    );
    const evaluated = evaluatedRows.length;
    const improved = evaluatedRows.filter((r) => r.outcome === 'IMPROVED').length;
    const worsened = evaluatedRows.filter((r) => r.outcome === 'WORSENED').length;
    const unchanged = evaluatedRows.filter((r) => r.outcome === 'UNCHANGED').length;
    const insufficientData = rows.filter(
      (r) => r.type === type && r.outcome === 'INSUFFICIENT_DATA',
    ).length;

    const enough =
      evaluated >= EFFECTIVENESS_THRESHOLDS.MIN_EVALUATED_SAMPLE;
    const improvementRate = evaluated > 0 ? round4(improved / evaluated) : null;
    const worseningRate = evaluated > 0 ? round4(worsened / evaluated) : null;

    // STRICT majorities: an even split is MIXED by definition.
    const verdict: TypeEffectiveness['verdict'] = !enough
      ? 'INSUFFICIENT_EVIDENCE'
      : improvementRate !== null && improvementRate > 0.5
        ? 'EFFECTIVE'
        : worseningRate !== null && worseningRate > 0.5
          ? 'HARMFUL'
          : 'MIXED';

    out.push({
      type,
      accepted,
      evaluated,
      improved,
      worsened,
      unchanged,
      insufficientData,
      improvementRate,
      worseningRate,
      verdict,
    });
  }
  return out.sort((a, b) => b.evaluated - a.evaluated);
};

/** Human-readable tuning insight — review input, NOT policy mutation. */
export const buildTuningInsights = (
  rows: TypeEffectiveness[],
): TuningInsight[] =>
  rows
    .filter((r) => r.verdict !== 'INSUFFICIENT_EVIDENCE')
    .map((r) => ({
      type: r.type,
      message:
        `${r.type}: ${Math.round((r.improvementRate ?? 0) * 100)}% of ` +
        `${r.evaluated} evaluated proposals improved ` +
        `(${r.unchanged} unchanged, ${r.worsened} worsened). Verdict: ${r.verdict}.`,
    }));
