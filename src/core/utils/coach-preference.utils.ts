import type { Intervention } from '../../module/intervention/intervention.types';

/**
 * Phase 3.4 — user-facing coach preferences.
 * Tones and frequencies are USER preferences; the model's response tone
 * remains a separate, validated enum inside the AI layer.
 */
export const COACH_TONE_VALUES = [
  'ENCOURAGING',
  'DIRECT',
  'CALM',
  'CHALLENGING',
  'BALANCED',
] as const;
export type CoachTonePref = (typeof COACH_TONE_VALUES)[number];

export const COACH_FREQUENCY_VALUES = [
  'MINIMAL',
  'STANDARD',
  'FREQUENT',
] as const;
export type CoachFrequency = (typeof COACH_FREQUENCY_VALUES)[number];

/** Intervention types a frequency tier is allowed to surface. */
const FREQUENCY_ALLOWED_TYPES: Record<CoachFrequency, ReadonlySet<string>> = {
  // Only restart-the-rhythm advice and critical-band interventions.
  MINIMAL: new Set(['RECOVERY']),
  // The important day-to-day guidance; identity reinforcement included.
  STANDARD: new Set([
    'RECOVERY',
    'REDUCE_DIFFICULTY',
    'PREPARE_FOR_RISK',
    'HABIT_STACK',
    'CHANGE_TIME',
    'REINFORCE_IDENTITY',
  ]),
  // Everything, including gentle momentum/celebration nudges.
  FREQUENT: new Set([
    'RECOVERY',
    'REDUCE_DIFFICULTY',
    'PREPARE_FOR_RISK',
    'HABIT_STACK',
    'CHANGE_TIME',
    'REINFORCE_IDENTITY',
    'PROTECT_MOMENTUM',
  ]),
};

/**
 * Pure frequency gate. CRITICAL-risk interventions always pass in every tier
 * (safety beats preference); everything else must be type-allowed.
 */
export const filterInterventionByFrequency = (
  intervention: Intervention | null,
  frequency: string,
): Intervention | null => {
  if (!intervention) return null;
  const allowed =
    FREQUENCY_ALLOWED_TYPES[(frequency as CoachFrequency) ?? 'STANDARD'] ??
    FREQUENCY_ALLOWED_TYPES.STANDARD;
  if (allowed.has(intervention.type)) return intervention;
  // Priority 100 encodes the CRITICAL band in the rule table.
  if (intervention.priority >= 100) return intervention;
  return null;
};

// ---------------------------------------------------------------------------
// Tone — affects LANGUAGE ONLY, never decision fields (spec §7)
// ---------------------------------------------------------------------------

interface ToneFraming {
  prefix: string;
  suffix: string;
}

const TONE_FRAMING: Record<CoachTonePref, ToneFraming> = {
  ENCOURAGING: {
    prefix: 'You can do this — ',
    suffix: '',
  },
  DIRECT: { prefix: '', suffix: '' },
  CALM: { prefix: 'No pressure either way, but ', suffix: '' },
  CHALLENGING: { prefix: '', suffix: ' Prove it to yourself.' },
  BALANCED: { prefix: '', suffix: '' },
};

/**
 * Deterministic tone framing for fallback copy. Identical inputs always
 * produce identical output; decision fields are never touched.
 */
export const applyToneToFallbackMessage = (
  message: string,
  tone: string,
): string => {
  const framing =
    TONE_FRAMING[(tone as CoachTonePref) ?? 'BALANCED'] ??
    TONE_FRAMING.BALANCED;
  const out = `${framing.prefix}${message}${framing.suffix}`.trim();
  return out === '' ? message : out;
};

/**
 * Instruction line appended to the system prompt so the MODEL matches the
 * user's chosen tone. Pure data — no business coupling in the AI layer.
 */
export const toneDirectiveForPrompt = (tone: string): string => {
  switch (tone) {
    case 'ENCOURAGING':
      return 'TONE: warm and encouraging, but stay honest.';
    case 'DIRECT':
      return 'TONE: direct and to the point. No fluff.';
    case 'CALM':
      return 'TONE: calm and low-pressure. Never urgent.';
    case 'CHALLENGING':
      return 'TONE: respectfully challenging. Invite the user to rise to it.';
    default:
      return 'TONE: balanced. Mix warmth with practicality.';
  }
};
