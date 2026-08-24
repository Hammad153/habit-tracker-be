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

/**
 * Phase 4.3 — behavioral event retention.
 *
 * Events are OBSERVATIONAL data, not domain state. The longest legitimate
 * read window in the product is MAX_ADMIN_RANGE_DAYS (180), so retention
 * keeps a full year of history: funnels, outcome correlation and audit
 * trails remain intact long past any query horizon, while unbounded growth
 * is prevented. Deletion is a batched, idempotent, admin-operable operation
 * (see BehavioralEventService.pruneExpiredEvents); production should invoke
 * it from the deployment platform's scheduler once one exists.
 */
export const EVENT_RETENTION_DAYS = 365;

/** Hard cap on rows removed per prune invocation (bounded operations). */
export const PRUNE_MAX_BATCHES = 20;
export const PRUNE_BATCH_SIZE = 500;
