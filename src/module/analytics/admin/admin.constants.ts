/**
 * Phase 3.8 — admin analytics constants.
 * Privacy floor is centralized here; never duplicate the literal.
 */
export const MIN_AGGREGATE_SAMPLE = 5;

/** Maximum admin date-range window in days. */
export const MAX_ADMIN_RANGE_DAYS = 180;

/** Default analysis window when no explicit range is supplied. */
export const DEFAULT_ADMIN_RANGE_DAYS = 90;

export const SUPPRESSED_REASON = 'INSUFFICIENT_AGGREGATE_SAMPLE' as const;
