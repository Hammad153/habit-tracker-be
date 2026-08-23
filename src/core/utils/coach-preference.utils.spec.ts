import type { Intervention } from '../../module/intervention/intervention.types';
import {
  applyToneToFallbackMessage,
  filterInterventionByFrequency,
  toneDirectiveForPrompt,
} from './coach-preference.utils';

const intervention = (
  over: Partial<Omit<Intervention, 'type'>> & { type?: string },
): Intervention =>
  ({
    type: 'REINFORCE_IDENTITY',
    priority: 70,
    category: 'INFORMATIONAL',
    confidence: 'HIGH',
    title: 't',
    reason: 'r',
    suggestedAction: { type: 'NONE' },
    sourceSignals: [],
    fingerprint: 'fp',
    facts: {},
    ...over,
  }) as Intervention;

describe('coach frequency gating (spec §6)', () => {
  it('MINIMAL keeps recovery and critical-band interventions only', () => {
    expect(
      filterInterventionByFrequency(intervention({ type: 'RECOVERY' }), 'MINIMAL'),
    ).not.toBeNull();
    expect(
      filterInterventionByFrequency(intervention({ type: 'RECOVERY', priority: 100 }), 'MINIMAL'),
    ).not.toBeNull();
    expect(
      filterInterventionByFrequency(intervention({ type: 'REDUCE_DIFFICULTY' }), 'MINIMAL'),
    ).toBeNull();
    expect(
      filterInterventionByFrequency(intervention({ type: 'PROTECT_MOMENTUM' }), 'MINIMAL'),
    ).toBeNull();
  });

  it('STANDARD keeps important guidance but drops momentum nudges', () => {
    for (const type of ['RECOVERY', 'REDUCE_DIFFICULTY', 'PREPARE_FOR_RISK', 'HABIT_STACK', 'CHANGE_TIME', 'REINFORCE_IDENTITY']) {
      expect(filterInterventionByFrequency(intervention({ type }), 'STANDARD')).not.toBeNull();
    }
    expect(
      filterInterventionByFrequency(intervention({ type: 'PROTECT_MOMENTUM', priority: 76 }), 'STANDARD'),
    ).toBeNull();
  });

  it('FREQUENT surfaces everything', () => {
    for (const type of ['RECOVERY', 'REDUCE_DIFFICULTY', 'PREPARE_FOR_RISK', 'HABIT_STACK', 'CHANGE_TIME', 'REINFORCE_IDENTITY', 'PROTECT_MOMENTUM']) {
      expect(filterInterventionByFrequency(intervention({ type }), 'FREQUENT')).not.toBeNull();
    }
  });

  it('CRITICAL band passes even under MINIMAL regardless of type', () => {
    expect(
      filterInterventionByFrequency(intervention({ type: 'CHANGE_TIME', priority: 100 }), 'MINIMAL'),
    ).not.toBeNull();
  });

  it('null stays null; unknown frequencies fall back to STANDARD', () => {
    expect(filterInterventionByFrequency(null, 'FREQUENT')).toBeNull();
    expect(
      filterInterventionByFrequency(intervention({ type: 'PROTECT_MOMENTUM' }), 'SOMETIMES'),
    ).toBeNull();
  });
});

describe('coach tone framing (spec §7)', () => {
  it('never mutates decision fields — message-only transformation', () => {
    const base = 'Completion fell to 40% this week.';
    expect(applyToneToFallbackMessage(base, 'DIRECT')).toBe(base); // direct = verbatim
    expect(applyToneToFallbackMessage(base, 'ENCOURAGING')).toContain(base);
    expect(applyToneToFallbackMessage(base, 'CHALLENGING').endsWith('Prove it to yourself.')).toBe(true);
    expect(applyToneToFallbackMessage(base, 'CALM')).toContain('No pressure');
    expect(applyToneToFallbackMessage(base, 'BALANCED')).toBe(base);
  });

  it('is deterministic and unknown-tone safe', () => {
    const a = applyToneToFallbackMessage('x', 'ENCOURAGING');
    const b = applyToneToFallbackMessage('x', 'ENCOURAGING');
    expect(a).toBe(b);
    expect(applyToneToFallbackMessage('x', 'WILD')).toBe('x');
  });

  it('prompt directives are pure data per tone', () => {
    expect(toneDirectiveForPrompt('CALM')).toMatch(/calm/i);
    expect(toneDirectiveForPrompt('NOPE')).toContain('balanced');
  });
});
