/**
 * Phase 3.3 — AI provider abstraction.
 *
 * The application depends on `AiProvider`, never on a concrete vendor.
 * Providers turn already-computed behavioral facts into language ONLY —
 * they never calculate behavioral truth and never authorize actions.

 * ANALYTICS = TRUTH · INTERVENTION ENGINE = DECISION · AI = LANGUAGE
 */

export type CoachTone =
  | 'supportive'
  | 'direct'
  | 'celebratory'
  | 'cautionary';

/** Validated, structured language produced by a provider. */
export interface CoachLanguage {
  /** 3–8 words. */
  headline: string;
  /** 1–3 sentences. */
  message: string;
  tone: CoachTone;
  /** Optional CTA wording (never an action authority). */
  actionLabel?: string;
}

/** Controlled coaching context handed to a provider. */
export interface CoachPromptInput {
  /** Product persona + safety rules. Never contains user content. */
  system: string;
  /**
   * Structured facts as JSON text. User-created labels are embedded as
   * quoted DATA, never as instructions.
   */
  user: string;
}

export const AI_PROVIDER = 'AI_PROVIDER';

export interface AiProvider {
  readonly name: string;
  readonly model: string | null;
  generateCoachResponse(input: CoachPromptInput): Promise<CoachLanguage>;
}

/** Raised for any provider-side failure; details are safe to log, not to leak. */
export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly kind:
      | 'NOT_CONFIGURED'
      | 'TIMEOUT'
      | 'RATE_LIMITED'
      | 'HTTP_ERROR'
      | 'BAD_RESPONSE'
      | 'NETWORK',
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}
