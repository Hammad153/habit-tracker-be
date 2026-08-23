import type { Intervention } from './intervention.types';
import type { CoachTone } from '../../core/ai/ai-provider.interface';

export interface FallbackCoach {
  headline: string;
  message: string;
  tone: CoachTone;
  actionLabel: string;
}

const HEADLINES: Record<string, string> = {
  RECOVERY: 'Restart small today',
  REDUCE_DIFFICULTY: 'Make it easier right now',
  USE_MINIMUM_VERSION: 'Use the minimum version',
  USE_EMERGENCY_VERSION: 'Use the emergency version',
  HABIT_STACK: 'Attach it to a routine',
  CHANGE_TIME: 'Try a better time window',
  CHANGE_CUE: 'Adjust your cue',
  REINFORCE_IDENTITY: 'Keep showing up',
  PROTECT_MOMENTUM: 'Protect the rhythm',
  PREPARE_FOR_RISK: 'Prepare for a harder day',
};

const TONES: Record<string, CoachTone> = {
  RECOVERY: 'supportive',
  REDUCE_DIFFICULTY: 'direct',
  HABIT_STACK: 'supportive',
  CHANGE_TIME: 'direct',
  REINFORCE_IDENTITY: 'celebratory',
  PROTECT_MOMENTUM: 'celebratory',
  PREPARE_FOR_RISK: 'cautionary',
};

const ACTION_LABELS: Record<string, string> = {
  NONE: '',
  USE_MINIMUM_VERSION: 'Use Minimum Version',
  USE_EMERGENCY_VERSION: 'Use Emergency Version',
  OPEN_HABIT_EDIT: 'Adjust Habit',
  CONFIGURE_HABIT_STACK: 'Set Up Stack',
  REVIEW_ACTIVE_HABITS: 'Review Habits',
};

/**
 * Deterministic coaching copy used when NVIDIA is unavailable or unusable.
 * Pure and stable: identical interventions always yield identical fallbacks.
 */
export const buildFallbackCoach = (
  intervention: Intervention,
): FallbackCoach => {
  const type = intervention.type;
  return {
    headline: HEADLINES[type] ?? 'Stay consistent',
    // The deterministic reason IS the message — explainable by construction.
    message: intervention.reason,
    tone: TONES[type] ?? 'supportive',
    actionLabel:
      ACTION_LABELS[intervention.suggestedAction.type] ?? '',
  };
};
