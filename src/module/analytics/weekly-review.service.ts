import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { AI_PROVIDER, AiProviderError } from '../../core/ai/ai-provider.interface';
import type { AiProvider } from '../../core/ai/ai-provider.interface';
import { WeeklyReviewLanguageDto } from '../../core/ai/providers/nvidia/nvidia.config';
import { parseValidatedJson } from '../../core/ai/structured-output.util';
import { DatabaseService } from '../../core/database/database.service';
import {
  localDateKeyInZone,
  resolveWeeklyAnalysisDate,
  WeekRange,
  WeeklyDateError,
} from '../../core/utils/week.utils';
import { HabitAnalyticsService } from './habit-analytics.service';
import { IdentityService } from '../identity/identity.service';
import {
  WeeklyHabitEntry,
  WeeklyReviewFacts,
  buildWeeklyReviewFacts,
} from './weekly-facts.utils';
import {
  DeterministicReview,
  buildDeterministicWeeklyReview,
} from './weekly-review.fallbacks';
import {
  WEEKLY_REVIEW_SYSTEM_PROMPT,
  buildWeeklyReviewUserPrompt,
} from './weekly-review.prompt';

const MAX_HABITS = 50;

export interface WeeklyReviewView extends DeterministicReview {
  tone: string;
}

export interface WeeklyReviewResponse {
  week: WeekRange;
  /** True while the reviewed week has not finished yet. */
  inProgress: boolean;
  /** False when the user disabled weekly reviews entirely. */
  enabled?: boolean;
  review: WeeklyReviewView | null;
  ai: { provider: string; generated: boolean; model?: string };
}

interface StoredReviewRow {
  weekStart: string;
  weekEnd: string;
  status: string;
  provider: string;
  generated: boolean;
  model: string | null;
  headline: string;
  summary: string;
  wins: unknown;
  patterns: unknown;
  identityReflection: string;
  nextWeekFocus: unknown;
}

@Injectable()
export class WeeklyReviewService {
  private readonly logger = new Logger(WeeklyReviewService.name);
  /** Best-effort in-flight lock; correctness never depends on it (§19). */
  private readonly inFlight = new Map<string, Promise<WeeklyReviewResponse>>();

  constructor(
    private readonly databaseSvc: DatabaseService,
    private readonly habitAnalyticsSvc: HabitAnalyticsService,
    private readonly identitySvc: IdentityService,
    @Inject(AI_PROVIDER) private readonly aiProvider: AiProvider,
  ) {}

  public async getWeeklyReview(
    userId: string,
    weekParam?: string,
  ): Promise<WeeklyReviewResponse> {
    const prefs = await this.loadPreferences(userId);
    const user = await this.databaseSvc.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    // Real "now" in the user's zone decides week lifecycle; the ?week= param
    // only SELECTS which week to look at.
    const realToday = localDateKeyInZone(user?.timezone ?? null);
    const { range } = this.resolveRangeOrThrow(weekParam, user?.timezone);

    if (!prefs.weeklyReviewEnabled) {
      return {
        week: range,
        inProgress: false,
        enabled: false,
        review: null,
        ai: { provider: 'none', generated: false },
      };
    }

    const isComplete = range.end < realToday;
    const isCurrent = realToday >= range.start && realToday <= range.end;
    if (!isComplete && !isCurrent) {
      throw new BadRequestException('week must not be in the future');
    }

    // Completed weeks use the persisted lifecycle (cache-first, §25).
    if (isComplete) {
      const stored = await this.databaseSvc.weeklyBehaviorReview.findUnique({
        where: { userId_weekStart: { userId, weekStart: range.start } },
      });
      if (stored) return this.fromStored(stored);
    }

    const cacheKey = `${userId}|${range.start}`;
    const pending = this.inFlight.get(cacheKey);
    if (pending) return pending;

    const job = this.generateAndPersist(
      userId,
      range,
      isComplete,
      prefs.coachTone,
      // Live weeks render deterministically — no AI spend on a moving target.
      isComplete && prefs.aiCoachEnabled !== false,
    ).finally(() => this.inFlight.delete(cacheKey));
    this.inFlight.set(cacheKey, job);
    return job;
  }

  /** Regeneration keeps ONE row per week and never touches other domains. */
  public async regenerateWeeklyReview(
    userId: string,
    weekParam?: string,
  ): Promise<WeeklyReviewResponse> {
    const user = await this.databaseSvc.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const realToday = localDateKeyInZone(user?.timezone ?? null);
    const { range } = this.resolveRangeOrThrow(weekParam, user?.timezone);
    if (!(range.end < realToday)) {
      throw new BadRequestException('only completed weeks can be regenerated');
    }
    const prefs = await this.loadPreferences(userId);
    if (!prefs.weeklyReviewEnabled) {
      throw new BadRequestException('weekly reviews are disabled');
    }
    await this.databaseSvc.weeklyBehaviorReview.deleteMany({
      where: { userId, weekStart: range.start },
    });
    return this.generateAndPersist(
      userId,
      range,
      true,
      prefs.coachTone,
      prefs.aiCoachEnabled === true,
    );
  }

  // -------------------------------------------------------------------------

  private async generateAndPersist(
    userId: string,
    range: WeekRange,
    isComplete: boolean,
    prefTone: string,
    allowAi: boolean,
  ): Promise<WeeklyReviewResponse> {
    const facts = await this.buildFacts(userId, range);

    let language: WeeklyReviewView | null = null;
    if (allowAi && this.aiProvider.model && !facts.insufficientHistory) {
      language = await this.generateLanguageWithRetry(facts, prefTone, range.start);
    } else if (facts.insufficientHistory) {
      this.logger.log({
        provider: 'fallback',
        outcome: 'skipped-ai-insufficient-history',
        weekStart: range.start,
      });
    }

    let review: WeeklyReviewView;
    let aiMeta: WeeklyReviewResponse['ai'];
    if (language) {
      review = language;
      aiMeta = {
        provider: 'nvidia',
        generated: true,
        model: this.aiProvider.model ?? undefined,
      };
    } else {
      review = {
        ...buildDeterministicWeeklyReview(facts, prefTone),
        tone: prefTone,
      };
      aiMeta = { provider: 'fallback', generated: false };
    }

    if (isComplete) {
      await this.persistReview(userId, range, review, aiMeta);
    }
    return { week: range, inProgress: !isComplete, review, ai: aiMeta };
  }

  /** One retry on invalid output (spec §8-style), then deterministic fallback. */
  private async generateLanguageWithRetry(
    facts: WeeklyReviewFacts,
    prefTone: string,
    weekStart: string,
  ): Promise<WeeklyReviewView | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const rawText = await this.aiProvider.generateRawText({
          system: WEEKLY_REVIEW_SYSTEM_PROMPT,
          user: buildWeeklyReviewUserPrompt(facts, prefTone),
        });
        const dto = parseValidatedJson(rawText, WeeklyReviewLanguageDto);
        return {
          headline: dto.headline.trim(),
          summary: dto.summary.trim(),
          wins: dto.wins.map((w) => w.trim()),
          patterns: dto.patterns.map((p) => p.trim()),
          identityReflection: (dto.identityReflection ?? '').trim(),
          nextWeekFocus: dto.nextWeekFocus.map((f) => f.trim()),
          tone: dto.tone || prefTone,
        };
      } catch (err) {
        const reason =
          err instanceof AiProviderError
            ? err.kind
            : err instanceof Error
              ? err.message
              : 'unknown';
        this.logger.warn({
          provider: 'nvidia',
          outcome: attempt === 0 ? 'retrying' : 'fallback',
          reason: String(reason),
          weekStart,
        });
      }
    }
    return null;
  }

  /**
   * Deterministic facts from EXISTING Phase 3.1 reports + real Identity data.
   * A single unreadable habit or identity failure never blocks the review.
   */
  private async buildFacts(
    userId: string,
    range: WeekRange,
  ): Promise<WeeklyReviewFacts> {
    const habits = await this.databaseSvc.habit.findMany({
      where: { userId, isArchived: false },
      select: { id: true, title: true },
      take: MAX_HABITS,
      orderBy: { createdAt: 'asc' },
    });

    const entries: WeeklyHabitEntry[] = [];
    for (const habit of habits) {
      try {
        // asOf = weekEnd → every Phase 3.1 window aligns to the reviewed week.
        const report = await this.habitAnalyticsSvc.getHabitBehaviorReport(
          userId,
          habit.id,
          range.end,
        );
        entries.push({ habitId: habit.id, title: habit.title, report });
      } catch {
        // Skip unreadable habits silently.
      }
    }

    let identities: WeeklyReviewFacts['identity'] = [];
    try {
      const all = await this.identitySvc.findAll(userId, range.end);
      identities = all
        .filter((i) => i.status === 'ACTIVE')
        .sort((a, b) => b.evidencePoints - a.evidencePoints)
        .slice(0, 3)
        .map((i) => ({
          name: typeof i.title === 'string' ? i.title : '',
          evidencePoints: Number(i.evidencePoints ?? 0),
          levelTitle: String(i.levelTitle ?? ''),
        }));
    } catch {
      identities = [];
    }

    return buildWeeklyReviewFacts(range, entries, identities);
  }

  private async persistReview(
    userId: string,
    range: WeekRange,
    review: WeeklyReviewView,
    aiMeta: WeeklyReviewResponse['ai'],
  ): Promise<void> {
    const data = {
      status: 'READY',
      provider: aiMeta.provider,
      generated: aiMeta.generated,
      model: aiMeta.model ?? null,
      headline: review.headline,
      summary: review.summary,
      wins: review.wins,
      patterns: review.patterns,
      identityReflection: review.identityReflection,
      nextWeekFocus: review.nextWeekFocus,
    };
    try {
      await this.databaseSvc.weeklyBehaviorReview.upsert({
        where: { userId_weekStart: { userId, weekStart: range.start } },
        create: { userId, weekStart: range.start, weekEnd: range.end, ...data },
        update: data,
      });
    } catch {
      // A concurrent generation won the race — the winner's row stands (§19).
    }
  }

  private fromStored(row: StoredReviewRow): WeeklyReviewResponse {
    return {
      week: { start: row.weekStart, end: row.weekEnd },
      inProgress: row.status !== 'READY',
      review: {
        headline: row.headline,
        summary: row.summary,
        wins: Array.isArray(row.wins) ? (row.wins as string[]) : [],
        patterns: Array.isArray(row.patterns) ? (row.patterns as string[]) : [],
        identityReflection: row.identityReflection,
        nextWeekFocus: Array.isArray(row.nextWeekFocus)
          ? (row.nextWeekFocus as string[])
          : [],
        tone: 'BALANCED', // historical rows pre-date per-row tone storage
      },
      ai: {
        provider: row.provider,
        generated: row.generated,
        ...(row.model ? { model: row.model } : {}),
      },
    };
  }

  private resolveRangeOrThrow(
    weekParam: string | undefined,
    timezone: string | null | undefined,
  ) {
    try {
      return resolveWeeklyAnalysisDate(weekParam, timezone);
    } catch (err) {
      if (err instanceof WeeklyDateError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  private async loadPreferences(userId: string) {
    const user = await this.databaseSvc.user.findUnique({
      where: { id: userId },
      select: {
        coachEnabled: true,
        aiCoachEnabled: true,
        coachTone: true,
        coachFrequency: true,
        weeklyReviewEnabled: true,
      },
    });
    return (
      user ?? {
        coachEnabled: true,
        aiCoachEnabled: true,
        coachTone: 'BALANCED',
        coachFrequency: 'STANDARD',
        weeklyReviewEnabled: true,
      }
    );
  }
}
