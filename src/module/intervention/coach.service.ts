import { Inject, Injectable, Logger } from '@nestjs/common';
import { AI_PROVIDER } from '../../core/ai/ai-provider.interface';
import type { AiProvider, CoachTone } from '../../core/ai/ai-provider.interface';
import {
  FallbackCoach,
  buildFallbackCoach,
} from './coach.fallbacks';
import {
  COACH_SYSTEM_PROMPT,
  buildCoachUserPrompt,
} from './coach.prompt';
import { InterventionService } from './intervention.service';
import { Intervention } from './intervention.types';

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const HEADLINE_MAX = 80;
const MESSAGE_MAX = 480;
const LABEL_MAX = 60;

export interface CoachView {
  headline: string;
  message: string;
  tone: CoachTone;
  actionLabel?: string;
  /** Always the DETERMINISTIC action — never chosen by the model (§23). */
  actionType: string;
}

export interface CoachEndpointResponse {
  coach: CoachView | null;
  intervention: {
    type: string;
    priority: number;
    confidence: string;
    fingerprint: string;
    sourceSignals: string[];
    suggestedAction: { type: string };
  } | null;
  ai: { provider: string; generated: boolean; model?: string };
}

const clean = (raw: string | undefined, max: number): string => {
  if (!raw) return '';
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
};

/**
 * Phase 3.3 — AI coaching layer.
 *
 * Deterministic systems compute truth and decide actions; NVIDIA only words
 * them. Every failure path lands on a stable deterministic fallback so the
 * product never depends on AI availability (spec §6).
 */
@Injectable()
export class CoachService {
  private readonly logger = new Logger(CoachService.name);
  private readonly cache = new Map<
    string,
    { expiresAt: number; coach: Omit<CoachView, 'actionType'> }
  >();

  constructor(
    private readonly interventionSvc: InterventionService,
    @Inject(AI_PROVIDER) private readonly aiProvider: AiProvider,
  ) {}

  public async getCoachForHabit(
    userId: string,
    habitId: string,
    date?: string,
  ): Promise<CoachEndpointResponse> {
    const { intervention, context } =
      await this.interventionSvc.getForHabitWithIntervention(
        userId,
        habitId,
        date,
      );

    if (!intervention) {
      return { coach: null, intervention: null, ai: { provider: 'none', generated: false } };
    }

    const authoritative = {
      type: intervention.type,
      priority: intervention.priority,
      confidence: intervention.confidence,
      fingerprint: intervention.fingerprint,
      sourceSignals: [...intervention.sourceSignals],
      suggestedAction: { ...intervention.suggestedAction },
    };

    const fallback = buildFallbackCoach(intervention);
    const assemble = (
      language: Omit<CoachView, 'actionType'> & { actionLabel?: string },
      generated: boolean,
      provider: string,
    ): CoachEndpointResponse => ({
      coach: this.withAuthoritativeAction(language, fallback, intervention),
      intervention: authoritative,
      ai: {
        provider,
        generated,
        ...(provider === 'nvidia' ? { model: this.aiProvider.model ?? undefined } : {}),
      },
    });

    const cacheKey = `${authoritative.fingerprint}|${this.aiProvider.model ?? 'none'}`;
    const cached = this.readCache(cacheKey);
    if (cached) return assemble(cached, true, 'nvidia');

    try {
      const language = await this.aiProvider.generateCoachResponse({
        system: COACH_SYSTEM_PROMPT,
        user: buildCoachUserPrompt(intervention, {
          title: context.habitTitle,
          identityTitle: context.identityTitle,
          fullBehavior: context.fullBehavior,
          minimumBehavior: context.minimumBehavior,
          emergencyMinimum: context.emergencyMinimum,
        }),
      });
      const view: Omit<CoachView, 'actionType'> = {
        headline: clean(language.headline, HEADLINE_MAX),
        message: clean(language.message, MESSAGE_MAX),
        tone: language.tone,
        actionLabel: clean(language.actionLabel, LABEL_MAX),
      };
      this.writeCache(cacheKey, view);
      this.logger.log({
        provider: 'nvidia',
        model: this.aiProvider.model,
        interventionType: intervention.type,
        outcome: 'generated',
      });
      return assemble(view, true, 'nvidia');
    } catch (err) {
      const kind = err instanceof Error ? err.name : 'unknown';
      this.logger.warn({
        provider: 'fallback',
        interventionType: intervention.type,
        outcome: 'fallback',
        reason: kind,
      });
      return assemble(fallback, false, 'fallback');
    }
  }

  /**
   * Action security (§23): the model may only supply wording for the ONE
   * action already authorized by the deterministic engine. Anything else is
   * replaced by the deterministic label.
   */
  private withAuthoritativeAction(
    language: { headline: string; message: string; tone: CoachTone; actionLabel?: string },
    fallback: FallbackCoach,
    intervention: Intervention,
  ): CoachView {
    const actionType = intervention.suggestedAction.type;
    const aiLabel =
      actionType !== 'NONE' ? clean(language.actionLabel, LABEL_MAX) : '';
    return {
      headline: language.headline || fallback.headline,
      message: language.message || fallback.message,
      tone: language.tone,
      actionLabel: aiLabel || fallback.actionLabel || undefined,
      actionType,
    };
  }

  // Cache is a pure optimization (§18): losing it must never change results.
  private readCache(key: string) {
    const hit = this.cache.get(key);
    if (!hit) return null;
    if (hit.expiresAt < Date.now()) {
      this.cache.delete(key);
      return null;
    }
    return hit.coach;
  }

  private writeCache(key: string, coach: Omit<CoachView, 'actionType'>): void {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, coach });
  }
}
