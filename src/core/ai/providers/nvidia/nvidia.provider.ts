import { Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  AiProvider,
  AiProviderError,
  CoachLanguage,
  CoachPromptInput,
} from '../../ai-provider.interface';
import {
  CoachLanguageDto,
  NvidiaConfig,
  loadNvidiaConfig,
} from './nvidia.config';

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

/**
 * Phase 3.3 — thin NVIDIA client targeting the OpenAI-compatible
 * inference interface. Knows NOTHING about habits/business logic.
 *
 * Failure modes are normalized to AiProviderError so callers can fall back
 * deterministically without knowing vendor details.
 */
@Injectable()
export class NvidiaProvider implements AiProvider {
  private readonly logger = new Logger(NvidiaProvider.name);
  private readonly config: NvidiaConfig | null;

  readonly name = 'nvidia';

  constructor() {
    this.config = loadNvidiaConfig();
    if (!this.config) {
      this.logger.warn(
        'NVIDIA provider disabled: NVIDIA_API_KEY / NVIDIA_MODEL not configured',
      );
    }
  }

  get model(): string | null {
    return this.config?.model ?? null;
  }

  get enabled(): boolean {
    return !!this.config;
  }

  async generateCoachResponse(input: CoachPromptInput): Promise<CoachLanguage> {
    if (!this.config) {
      throw new AiProviderError('provider not configured', 'NOT_CONFIGURED');
    }
    // One attempt, plus a single retry when the model returns unusable JSON.
    const first = await this.attempt(input);
    try {
      return this.parse(first);
    } catch {
      this.logger.log('coach output unusable; retrying once');
      const second = await this.attempt(input);
      return this.parse(second); // throws BAD_RESPONSE on repeated failure
    }
  }

  async generateRawText(input: CoachPromptInput): Promise<string> {
    if (!this.config) {
      throw new AiProviderError('provider not configured', 'NOT_CONFIGURED');
    }
    return this.attempt(input);
  }

  // -------------------------------------------------------------------------

  private async attempt(input: CoachPromptInput): Promise<string> {
    const cfg = this.config!;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    const startedAt = Date.now();
    try {
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            { role: 'system', content: input.system },
            { role: 'user', content: input.user },
          ],
          temperature: 0.7,
          top_p: 0.9,
          max_tokens: cfg.maxTokens,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startedAt;
      if (res.status === 429) {
        this.logFailure('RATE_LIMITED', latencyMs, 429);
        throw new AiProviderError('rate limited', 'RATE_LIMITED', 429);
      }
      if (!res.ok) {
        this.logFailure('HTTP_ERROR', latencyMs, res.status);
        throw new AiProviderError(
          `upstream status ${res.status}`,
          'HTTP_ERROR',
          res.status,
        );
      }

      const body = (await res.json()) as ChatCompletionResponse;
      const content = body?.choices?.[0]?.message?.content ?? '';
      if (typeof content !== 'string' || content.trim().length === 0) {
        this.logFailure('BAD_RESPONSE', latencyMs);
        throw new AiProviderError('empty model response', 'BAD_RESPONSE');
      }
      return content;
    } catch (err) {
      if (err instanceof AiProviderError) throw err;
      if (
        err instanceof Error &&
        (err.name === 'AbortError' ||
          /abort/i.test(err.message) ||
          /timeout/i.test(err.message))
      ) {
        this.logFailure('TIMEOUT', Date.now() - startedAt);
        throw new AiProviderError('request timed out', 'TIMEOUT');
      }
      this.logFailure('NETWORK', Date.now() - startedAt);
      throw new AiProviderError('network failure', 'NETWORK');
    } finally {
      clearTimeout(timer);
    }
  }

  /** Validates and narrows the raw model text. Never returns partial junk. */
  private parse(raw: string): CoachLanguage {
    let candidate: unknown;
    try {
      candidate = JSON.parse(this.extractJson(raw));
    } catch {
      throw new AiProviderError('malformed JSON', 'BAD_RESPONSE');
    }
    const dto = plainToInstance(CoachLanguageDto, candidate, {
      exposeUnsetFields: false,
    });
    const errors = validateSync(dto, { whitelist: true });
    if (errors.length > 0) {
      throw new AiProviderError('invalid coach payload', 'BAD_RESPONSE');
    }
    return {
      headline: dto.headline.trim(),
      message: dto.message.trim(),
      tone: dto.tone,
      actionLabel: dto.actionLabel?.trim(),
    };
  }

  /**
   * Tolerates models that wrap JSON in prose or code fences by grabbing the
   * outermost object literal.
   */
  private extractJson(text: string): string {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return text;
    return text.slice(start, end + 1);
  }

  /** Structured metadata only — never prompts, keys, or full user content. */
  private logFailure(
    kind: AiProviderError['kind'],
    latencyMs: number,
    status?: number,
  ): void {
    this.logger.warn({
      provider: this.name,
      model: this.model,
      kind,
      status,
      latencyMs,
    });
  }
}
