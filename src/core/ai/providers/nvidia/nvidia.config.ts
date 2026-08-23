import { COACH_TONE_VALUES } from '../../../utils/coach-preference.utils';
import type { CoachTone } from '../../ai-provider.interface';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Length } from 'class-validator';

/**
 * Environment-based NVIDIA configuration (spec §3).
 * Nothing vendor-specific leaks beyond this folder.
 */
export interface NvidiaConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
}

const DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_MAX_TOKENS = 160;

const intFromEnv = (raw: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * The provider is ENABLED only when both an API key and a model are set.
 * Missing configuration is a safe, logged no-op — the product never depends
 * on AI availability (spec §6).
 */
export const loadNvidiaConfig = (): NvidiaConfig | null => {
  const apiKey = process.env.NVIDIA_API_KEY?.trim() ?? '';
  const model = process.env.NVIDIA_MODEL?.trim() ?? '';
  if (!apiKey || !model) return null;
  return {
    apiKey,
    baseUrl: (process.env.NVIDIA_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(
      /\/+$/,
      '',
    ),
    model,
    timeoutMs: intFromEnv(process.env.NVIDIA_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    maxTokens: intFromEnv(process.env.NVIDIA_MAX_TOKENS, DEFAULT_MAX_TOKENS),
  };
};

export const COACH_TONES: readonly CoachTone[] = [
  'supportive',
  'direct',
  'celebratory',
  'cautionary',
];

/** Model-output schema (validated with the project's class-validator stack). */
export class CoachLanguageDto {
  @IsString()
  @Length(3, 80)
  headline!: string;

  @IsString()
  @Length(1, 480)
  message!: string;

  @IsIn(COACH_TONES as unknown as string[])
  tone!: CoachTone;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  actionLabel?: string;
}


/** Phase 3.4 — validated structured output for weekly behavioral reviews. */
export class WeeklyReviewLanguageDto {
  @IsString()
  @Length(3, 80)
  headline!: string;

  @IsString()
  @Length(1, 480)
  summary!: string;

  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  @Length(1, 120, { each: true })
  wins!: string[];

  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  @Length(1, 120, { each: true })
  patterns!: string[];

  @IsOptional()
  @IsString()
  @Length(0, 320)
  identityReflection?: string;

  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  @Length(1, 160, { each: true })
  nextWeekFocus!: string[];

  @IsIn(COACH_TONE_VALUES as unknown as string[])
  tone!: string;
}
