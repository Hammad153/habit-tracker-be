import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../core/database/database.service';
import {
  DEFAULT_ADMIN_RANGE_DAYS,
  MAX_ADMIN_RANGE_DAYS,
  MIN_AGGREGATE_SAMPLE,
  SUPPRESSED_REASON,
} from './admin.constants';
import {
  EffectivenessRow,
  TypeEffectiveness,
  aggregateEffectivenessByType,
  buildTuningInsights,
} from '../../../core/utils/adaptation-effectiveness.utils';
import { shiftDayKey } from '../../../core/utils/schedule.utils';
import { localDateKeyInZone } from '../../../core/utils/week.utils';

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export interface SuppressedMetric {
  suppressed: true;
  reason: typeof SUPPRESSED_REASON;
}

/**
 * Applies the centralized privacy floor: aggregates with fewer than
 * MIN_AGGREGATE_SAMPLE contributing records are reduced to a suppression
 * marker — exact counts of tiny cohorts are never exposed.
 */
const suppressIfSmall = <T extends { evaluated: number }>(
  agg: T & Partial<TypeEffectiveness>,
): T | (SuppressedMetric & { type: string; verdict: 'INSUFFICIENT_EVIDENCE' }) => {
  if (agg.evaluated >= MIN_AGGREGATE_SAMPLE) return agg;
  return {
    type: (agg as { type: string }).type,
    verdict: 'INSUFFICIENT_EVIDENCE',
    suppressed: true,
    reason: SUPPRESSED_REASON,
  };
};

@Injectable()
export class AdminAnalyticsService {
  constructor(private readonly databaseSvc: DatabaseService) {}

  /**
   * Cross-user adaptation effectiveness. Reuses the Phase 3.7 pure
   * aggregator VERBATIM; this layer only validates dates, reads rows and
   * applies the privacy floor. Read-only; zero AI.
   */
  public async getAdaptationEffectiveness(from?: string, to?: string) {
    const { startKey, endKey } = this.resolveRange(from, to);
    const startAt = new Date(`${startKey}T00:00:00.000Z`);
    const endAt = new Date(`${endKey}T23:59:59.999Z`);

    const acceptedRows = await this.databaseSvc.habitAdjustmentProposal.findMany({
      where: { status: 'ACCEPTED', acceptedAt: { gte: startAt, lte: endAt } },
      select: { type: true, outcome: true },
      take: 5000,
    });

    const rows: EffectivenessRow[] = acceptedRows
      .filter((r): r is typeof r & { outcome: EffectivenessRow['outcome'] } =>
        ['IMPROVED', 'WORSENED', 'UNCHANGED', 'INSUFFICIENT_DATA'].includes(
          r.outcome ?? '',
        ),
      )
      .map((r) => ({ type: r.type, outcome: r.outcome }));
    const acceptedTypes = acceptedRows.map((r) => r.type);

    const aggregates = aggregateEffectivenessByType(rows, acceptedTypes)
      .map((agg) => suppressIfSmall({ ...agg }))
      .map((entry) =>
        'suppressed' in entry && entry.suppressed
          ? entry
          : { ...entry, verdict: entry.verdict === 'EFFECTIVE' ? 'PROMISING' : entry.verdict },
      );

    const overallEvaluated = rows.filter(
      (r) => r.outcome !== 'INSUFFICIENT_DATA',
    ).length;
    const overall =
      overallEvaluated >= MIN_AGGREGATE_SAMPLE
        ? {
            suppressed: false as const,
            accepted: acceptedRows.length,
            evaluated: overallEvaluated,
            improved: rows.filter((r) => r.outcome === 'IMPROVED').length,
            worsened: rows.filter((r) => r.outcome === 'WORSENED').length,
            unchanged: rows.filter((r) => r.outcome === 'UNCHANGED').length,
            insufficientData: rows.filter(
              (r) => r.outcome === 'INSUFFICIENT_DATA',
            ).length,
          }
        : {
            suppressed: true as const,
            reason: SUPPRESSED_REASON,
          };

    // Tuning insights are labeled OBSERVATIONS and never mutate thresholds.
    const insights = buildTuningInsights(
      aggregateEffectivenessByType(rows, acceptedTypes).filter(
        (a) => a.evaluated >= MIN_AGGREGATE_SAMPLE,
      ),
    ).map((i) => ({ label: 'TUNING INSIGHT' as const, ...i }));

    return {
      window: { from: startKey, to: endKey },
      sampleStatus:
        overallEvaluated >= MIN_AGGREGATE_SAMPLE ? 'SUFFICIENT' : 'INSUFFICIENT',
      minimumSample: MIN_AGGREGATE_SAMPLE,
      proposalTypes: aggregates,
      overall,
      insights,
    };
  }

  /** High-level system aggregates — groupBy only, privacy floor applied. */
  public async getOverview() {
    const [users, activeHabits, proposalsByStatus, outcomesByOutcome, deliveriesByType, reviews] =
      await Promise.all([
        this.databaseSvc.user.count(),
        this.databaseSvc.habit.count({ where: { isArchived: false } }),
        this.databaseSvc.habitAdjustmentProposal.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        this.databaseSvc.habitAdjustmentProposal.groupBy({
          by: ['outcome'],
          where: { status: 'ACCEPTED' },
          _count: { _all: true },
        }),
        this.databaseSvc.notificationDelivery.groupBy({
          by: ['type'],
          _count: { _all: true },
        }),
        this.databaseSvc.weeklyBehaviorReview.count({
          where: { status: 'READY' },
        }),
      ]);

    const countOrSuppressed = (n: number) =>
      n >= MIN_AGGREGATE_SAMPLE ? n : { suppressed: true, reason: SUPPRESSED_REASON };

    return {
      users: { totalActive: countOrSuppressed(users) },
      habits: { totalActive: countOrSuppressed(activeHabits) },
      proposals: {
        pending: countOrSuppressed(
          proposalsByStatus.find((g) => g.status === 'PENDING')?._count._all ?? 0,
        ),
        accepted: countOrSuppressed(
          proposalsByStatus.find((g) => g.status === 'ACCEPTED')?._count._all ?? 0,
        ),
        rejected: countOrSuppressed(
          proposalsByStatus.find((g) => g.status === 'REJECTED')?._count._all ?? 0,
        ),
        expired: countOrSuppressed(
          proposalsByStatus.find((g) => g.status === 'EXPIRED')?._count._all ?? 0,
        ),
      },
      outcomes: {
        improved: countOrSuppressed(
          outcomesByOutcome.find((g) => g.outcome === 'IMPROVED')?._count._all ?? 0,
        ),
        worsened: countOrSuppressed(
          outcomesByOutcome.find((g) => g.outcome === 'WORSENED')?._count._all ?? 0,
        ),
        unchanged: countOrSuppressed(
          outcomesByOutcome.find((g) => g.outcome === 'UNCHANGED')?._count._all ?? 0,
        ),
        insufficientData: countOrSuppressed(
          outcomesByOutcome.find((g) => g.outcome === 'INSUFFICIENT_DATA')?._count._all ?? 0,
        ),
      },
      notifications: {
        deliveriesTotal: countOrSuppressed(
          deliveriesByType.reduce((s, g) => s + g._count._all, 0),
        ),
      },
      weeklyReviews: { completed: countOrSuppressed(reviews) },
      privacyFloor: MIN_AGGREGATE_SAMPLE,
    };
  }

  private resolveRange(from?: string, to?: string) {
    const todayKey = localDateKeyInZone(null);
    if (!from && !to) {
      return {
        startKey: shiftDayKey(todayKey, -(DEFAULT_ADMIN_RANGE_DAYS - 1)),
        endKey: todayKey,
      };
    }
    for (const [label, value] of [
      ['from', from],
      ['to', to],
    ] as const) {
      if (value === undefined) continue;
      if (!DAY_KEY.test(value)) {
        throw new BadRequestException(`${label} must be formatted as YYYY-MM-DD`);
      }
      const parsed = new Date(`${value}T00:00:00.000Z`);
      if (
        Number.isNaN(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== value
      ) {
        throw new BadRequestException(`${label} must be a valid calendar date`);
      }
    }
    const startKey = from ?? shiftDayKey(todayKey, -(DEFAULT_ADMIN_RANGE_DAYS - 1));
    const endKey = to ?? todayKey;
    if (startKey > endKey) {
      throw new BadRequestException('from must be on or before to');
    }
    const spanDays =
      Math.round(
        (new Date(`${endKey}T12:00:00Z`).getTime() -
          new Date(`${startKey}T12:00:00Z`).getTime()) /
          86_400_000,
      ) + 1;
    if (spanDays > MAX_ADMIN_RANGE_DAYS) {
      throw new BadRequestException(
        `range must not exceed ${MAX_ADMIN_RANGE_DAYS} days`,
      );
    }
    return { startKey, endKey };
  }
}

