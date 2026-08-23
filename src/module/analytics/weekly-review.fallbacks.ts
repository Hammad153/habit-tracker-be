import type { WeeklyReviewFacts } from './weekly-facts.utils';
import type { CoachTonePref } from '../../core/utils/coach-preference.utils';
import { applyToneToFallbackMessage } from '../../core/utils/coach-preference.utils';

/**
 * Phase 3.4 — deterministic weekly review copy (spec §18).
 * Built ONLY from real facts; identical facts yield identical reviews.
 */

export interface DeterministicReview {
  headline: string;
  summary: string;
  wins: string[];
  patterns: string[];
  identityReflection: string;
  nextWeekFocus: string[];
}

const pct = (v: number | null): string =>
  v === null ? '—' : `${Math.round(v * 100)}%`;

const withArticle = (title: string): string => {
  const t = title.trim();
  return /^[aeiou]/i.test(t) ? `an ${t}` : `a ${t}`;
};

export const buildDeterministicWeeklyReview = (
  facts: WeeklyReviewFacts,
  tone: CoachTonePref | string,
): DeterministicReview => {
  if (facts.insufficientHistory || facts.overall.completionRate === null) {
    return {
      headline: 'Your foundation is forming',
      summary:
        'There is not enough completed history this week for a full review yet. Every day you show up adds to the picture.',
      wins: [],
      patterns: [],
      identityReflection: '',
      nextWeekFocus: ['Pick one habit and complete its smallest version daily.'],
    };
  }

  const overallPct = pct(facts.overall.completionRate);
  const prevPct = pct(facts.overall.previousWeekRate);

  const headline =
    facts.overall.trend === 'IMPROVING'
      ? 'You became more consistent this week'
      : facts.overall.trend === 'DECLINING'
        ? 'A tougher week — restart small'
        : 'A steady week — the chain holds';

  // Wins — max 3, each tied to a real number.
  const wins: string[] = [];
  const improved = facts.habits
    .filter((h) => h.improved && h.completionRate !== null)
    .sort(
      (a, b) => (b.completionRate ?? 0) - (a.completionRate ?? 0),
    )[0];
  if (improved && improved.previousWeekRate !== null) {
    wins.push(
      `${improved.title}: ${pct(improved.previousWeekRate)} → ${pct(improved.completionRate)} this week.`,
    );
  }
  const streaky = [...facts.habits]
    .sort((a, b) => b.currentStreak - a.currentStreak)[0];
  if (streaky && streaky.currentStreak >= 3) {
    wins.push(`Longest active streak: ${streaky.currentStreak} days (${streaky.title}).`);
  }
  const recovered = facts.habits.find((h) => h.signal === 'RECOVERING');
  if (recovered) {
    wins.push(`${recovered.title} bounced back after a slow stretch.`);
  }

  // Patterns — max 3.
  const patterns: string[] = [];
  if (facts.patterns.weakestDay) {
    patterns.push(`${facts.patterns.weakestDay} remains your hardest day.`);
  }
  if (facts.patterns.bestDay && facts.patterns.bestDay !== facts.patterns.weakestDay) {
    patterns.push(`${facts.patterns.bestDay} is your strongest day.`);
  }
  const leaningOnMinimum = facts.habits.find(
    (h) => h.signal === 'TOO_HARD' && (h.completionRate ?? 0) >= 0.5,
  );
  if (leaningOnMinimum) {
    patterns.push(
      `Minimum versions are keeping ${leaningOnMinimum.title} alive — that is working.`,
    );
  }

  // Identity reflection — only from REAL identity data.
  let identityReflection = '';
  const topIdentity = facts.identity[0];
  if (topIdentity) {
    identityReflection =
      `You didn't just finish ${facts.overall.completedCount} habit-day(s) this week — ` +
      `you kept acting as ${withArticle(topIdentity.name)} ` +
      `(${topIdentity.evidencePoints} evidence points, level: ${topIdentity.levelTitle}).`;
  } else if (facts.overall.completedCount > 0) {
    identityReflection =
      `You showed up ${facts.overall.completedCount} time(s) this week. Consistency is becoming who you are.`;
  }

  // Next-week focus — max 2, derived from the weakest signals.
  const nextWeekFocus: string[] = [];
  const weakestHabit = [...facts.habits]
    .filter((h) => h.completionRate !== null)
    .sort((a, b) => (a.completionRate ?? 1) - (b.completionRate ?? 0))[0];
  if (weakestHabit && (weakestHabit.completionRate ?? 1) < 0.5) {
    nextWeekFocus.push(
      `Restart ${weakestHabit.title} small next week — consistency before volume.`,
    );
  }
  if (facts.patterns.weakestDay) {
    nextWeekFocus.push(
      `Protect ${facts.patterns.weakestDay}: decide your minimum version in advance.`,
    );
  }
  if (nextWeekFocus.length === 0) {
    const strongest = streaky?.title ?? 'your core habit';
    nextWeekFocus.push(`Keep ${strongest} exactly where it is — protect what works.`);
  }

  const summary = applyToneToFallbackMessage(
    `You completed ${overallPct} of scheduled habit-days` +
      (facts.overall.previousWeekRate !== null
        ? `, against ${prevPct} last week (${facts.overall.trend.toLowerCase()}).`
        : '.'),
    tone,
  );

  return {
    headline,
    summary,
    wins: wins.slice(0, 3),
    patterns: patterns.slice(0, 3),
    identityReflection,
    nextWeekFocus: nextWeekFocus.slice(0, 2),
  };
};
