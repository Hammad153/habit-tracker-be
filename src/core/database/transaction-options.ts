/**
 * Shared budgets for interactive ($transaction) usage.
 *
 * The managed remote Postgres endpoint regularly exceeds Prisma's default
 * 5s interactive-transaction timeout under load, which surfaces as
 * "A commit cannot be executed on an expired transaction". These budgets
 * (10s to START a transaction, 30s to RUN one) match the values already
 * proven in users.service and keep every domain service consistent.
 */
export const INTERACTIVE_TX_OPTIONS = {
  maxWait: 10_000,
  timeout: 30_000,
} as const;
