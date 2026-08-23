import { BehaviorReport } from '../../core/utils/behavior-analytics.utils';
import {
  ACTION_CATEGORY,
  evidenceLevelFor,
  INTERVENTION_RULES,
} from './intervention.constants';
import {
  Intervention,
  InterventionHabitContext,
} from './intervention.types';

/**
 * Phase 3.2 — pure deterministic intervention engine.
 *
 * No database, no HTTP, no AI, no side effects. Given the same report,
 * context and date it always produces the same result (or null).
 */
export const evaluateIntervention = (
  report: BehaviorReport,
  ctx: InterventionHabitContext,
): Omit<Intervention, 'fingerprint'> | null => {
  // Archived habits never receive actionable advice.
  if (report.isArchived) return null;

  // Tiny samples must not produce behavioral claims (spec §15).
  if (report.insufficientHistory) return null;

  for (const rule of INTERVENTION_RULES) {
    const draft = rule.evaluate({ report, ctx });
    if (!draft) continue;
    return {
      type: draft.type,
      priority: rule.priority,
      category: ACTION_CATEGORY[draft.suggestedAction],
      confidence: evidenceLevelFor(report.kindMix30.total),
      title: draft.title,
      reason: draft.reason,
      suggestedAction: { type: draft.suggestedAction },
      sourceSignals: Array.from(new Set(draft.sourceSignals)).sort(),
      facts: { ...draft.facts, asOf: ctx.todayKey },
    };
  }
  return null;
};
