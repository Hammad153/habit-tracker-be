import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AI_PROVIDER } from '../../../core/ai/ai-provider.interface';
import type { AiProvider } from '../../../core/ai/ai-provider.interface';
import {
  MAX_ADMIN_RANGE_DAYS,
  MIN_AGGREGATE_SAMPLE,
  SUPPRESSED_REASON,
} from './admin.constants';
import { DatabaseService } from '../../../core/database/database.service';
import { BehavioralEventService } from '../behavioral-event.service';
import {
  EffectivenessRow,
  aggregateEffectivenessByType,
  buildTuningInsights,
} from '../../../core/utils/adaptation-effectiveness.utils';
import { shiftDayKey } from '../../../core/utils/schedule.utils';
import { localDateKeyInZone, mondayOf } from '../../../core/utils/week.utils';
import { buildBehaviorReport } from '../../../core/utils/behavior-analytics.utils';
import { BEHAVIOR_WINDOWS } from '../../../core/utils/behavior.constants';
import {
  HabitLoadSummary,
  buildPortfolioOverloadReport,
} from '../portfolio-overload.engine';

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const SAMPLED_USERS = 25;

export interface SuppressedMetric {
  suppressed: true;
  reason: typeof SUPPRESSED_REASON;
}

/** Centralized privacy-floor helper (Phase 3.8 semantics). */
const floorCount = (n: number): number | SuppressedMetric =>
  n >= MIN_AGGREGATE_SAMPLE
    ? n
    : { suppressed: true, reason: SUPPRESSED_REASON };

const pct = (v: number | null): number | null =>
  v === null ? null : Number(v.toFixed(4));

/**
 * Phase 3.9 — admin behavioral intelligence dashboard.
 *
 * OBSERVABILITY ONLY: read-only, deterministic, privacy-floored. Interventions
 * and pre-delivery notification candidates are computed on demand and are NOT
 * persisted anywhere, so those specific metrics are reported honestly as
 * NOT_MEASURABLE instead of being invented.
 */
@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly databaseSvc: DatabaseService,
    private readonly behavioralEvents: BehavioralEventService,
    @Inject(AI_PROVIDER) private readonly aiProvider: AiProvider,
  ) {}

  public async getDashboard(from?: string, to?: string) {
    const { startKey, endKey, isInProgress } = this.resolvePeriod(from, to);
    const startAt = new Date(`${startKey}T00:00:00.000Z`);
    const endAt = new Date(`${endKey}T23:59:59.999Z`);

    // ---- Adaptation pipeline (persisted truth) ----------------------------
    const proposalsInRange = await this.databaseSvc.habitAdjustmentProposal.findMany({
      where: { createdAt: { gte: startAt, lte: endAt } },
      select: { status: true, type: true, outcome: true, confidence: true },
      take: 5000,
    });
    const acceptedInRange = await this.databaseSvc.habitAdjustmentProposal.findMany({
      where: {
        status: 'ACCEPTED',
        acceptedAt: { gte: startAt, lte: endAt },
      },
      select: { type: true, outcome: true },
      take: 5000,
    });

    const rows: EffectivenessRow[] = acceptedInRange
      .filter((r): r is typeof r & { outcome: EffectivenessRow['outcome'] } =>
        ['IMPROVED', 'WORSENED', 'UNCHANGED', 'INSUFFICIENT_DATA'].includes(r.outcome ?? ''),
      )
      .map((r) => ({ type: r.type, outcome: r.outcome }));
    const evaluatedTotal = rows.filter((r) => r.outcome !== 'INSUFFICIENT_DATA').length;

    const effectivenessByType = aggregateEffectivenessByType(
      rows,
      acceptedInRange.map((r) => r.type),
    ).map((agg) => ({
      type: agg.type,
      proposed: proposalsInRange.filter((p) => p.type === agg.type).length,
      accepted: acceptedInRange.filter((p) => p.type === agg.type).length,
      rejected: proposalsInRange.filter(
        (p) => p.type === agg.type && p.status === 'REJECTED',
      ).length,
      evaluated: agg.evaluated,
      improved: agg.improved,
      worsened: agg.worsened,
      unchanged: agg.unchanged,
      insufficientEvidence: rows.filter(
        (r) => r.type === agg.type && r.outcome === 'INSUFFICIENT_DATA',
      ).length,
      // ≥10 evaluated required before any effectiveness verdict (spec §6).
      effectivenessRate:
        agg.evaluated >= 10 ? pct(agg.improved / agg.evaluated) : null,
      verdict:
        agg.evaluated >= 10 ? agg.verdict : ('INSUFFICIENT_DATA' as const),
    }));

    const tuningInsights = buildTuningInsights(
      aggregateEffectivenessByType(rows, acceptedInRange.map((r) => r.type)).filter(
        (a) => a.evaluated >= MIN_AGGREGATE_SAMPLE,
      ),
    ).map((i) => ({ label: 'TUNING INSIGHT' as const, ...i }));

    const statusCount = (status: string): number | SuppressedMetric =>
      floorCount(proposalsInRange.filter((p) => p.status === status).length);

    // ---- Bounded behavioral sample (pure engines reused) -------------------
    const sample = await this.sampleBehavior(todayKey());

    // ---- Behavioral event funnel (Phase 4.1 ledger) -------------------------
    const events = await this.behavioralEvents.funnelCounts(
      'ADMIN_SCOPE_ALL',
      startAt,
      endAt,
    );

    return {
      generatedAt: new Date().toISOString(),
      period: { from: startKey, to: endKey, inProgress: isInProgress },
      users: {
        active: floorCount(await this.databaseSvc.user.count()),
        analyzed: floorCount(sample.userCount),
      },
      habits: {
        active: floorCount(
          await this.databaseSvc.habit.count({ where: { isArchived: false } }),
        ),
        analyzed: floorCount(sample.summaries.length),
      },
      behavior: {
        riskDistribution: this.distribution(
          sample.summaries.map((s) => s.riskLevel ?? 'UNKNOWN'),
        ),
        momentumDistribution: this.distribution(
          sample.summaries.map((s) => s.momentumLevel ?? 'UNKNOWN'),
        ),
        signalDistribution: this.signalDistribution(sample.summaries),
        note:
          'Sampled from the most recently active users; see confidence field.',
        sampleConfidence: sample.confidence,
      },
      interventions: {
        // Phase 4.1 — measured from the immutable event ledger.
        generated: floorCount(events.INTERVENTION_GENERATED ?? 0),
        viewed: floorCount(events.INTERVENTION_VIEWED ?? 0),
        dismissed: floorCount(events.INTERVENTION_DISMISSED ?? 0),
        actionStarted: floorCount(
          events.INTERVENTION_ACTION_STARTED ?? 0,
        ),
        actionCompleted: floorCount(
          events.INTERVENTION_ACTION_COMPLETED ?? 0,
        ),
        viewRate: this.rate(
          events.INTERVENTION_VIEWED ?? 0,      // numerator
          events.INTERVENTION_GENERATED ?? 0,   // denominator (§14)
        ),
        actionRate: this.rate(
          events.INTERVENTION_ACTION_COMPLETED ?? 0,
          events.INTERVENTION_GENERATED ?? 0,
        ),
        byType: 'NOT_MEASURABLE' as const, // intervention type lives on the
        // response payload, not yet on the ledger row (future column).
        acceptanceRate: this.acceptanceRate(
          proposalsInRange.length,
          proposalsInRange.filter((p) => p.status === 'ACCEPTED').length,
        ),
      },
      adaptations: {
        proposed: floorCount(proposalsInRange.length),
        accepted: floorCount(acceptedInRange.length),
        rejected: statusCount('REJECTED'),
        expired: statusCount('EXPIRED'),
        pending: statusCount('PENDING'),
        evaluated: floorCount(evaluatedTotal),
        improved: floorCount(rows.filter((r) => r.outcome === 'IMPROVED').length),
        worsened: floorCount(rows.filter((r) => r.outcome === 'WORSENED').length),
        unchanged: floorCount(rows.filter((r) => r.outcome === 'UNCHANGED').length),
        insufficientEvidence: floorCount(
          rows.filter((r) => r.outcome === 'INSUFFICIENT_DATA').length,
        ),
        effectivenessByType,
      },
      overload: {
        detected: floorCount(sample.overloadedUsers),
        affectedHabitCount: floorCount(sample.overloadedHabitContributors),
        affectedUserCount: floorCount(sample.overloadedUsers),
        note: 'Estimated from the bounded behavioral sample (Phase 3.6 engine).',
      },
      notifications: {
        // Phase 4.1 — full measurable funnel from the event ledger.
        candidates: floorCount(events.NOTIFICATION_CANDIDATE_GENERATED ?? 0),
        delivered: floorCount(events.NOTIFICATION_DELIVERED ?? 0),
        opened: floorCount(events.NOTIFICATION_OPENED ?? 0),
        dismissed: floorCount(events.NOTIFICATION_DISMISSED ?? 0),
        actionStarted: floorCount(events.NOTIFICATION_ACTION_STARTED ?? 0),
        actionCompleted: floorCount(events.NOTIFICATION_ACTION_COMPLETED ?? 0),
        deliveryRate: this.rate(
          events.NOTIFICATION_DELIVERED ?? 0,
          events.NOTIFICATION_CANDIDATE_GENERATED ?? 0,
        ),
        openRate: this.rate(
          events.NOTIFICATION_OPENED ?? 0,
          events.NOTIFICATION_DELIVERED ?? 0, // correct denominator (§14)
        ),
        actionRate: this.rate(
          events.NOTIFICATION_ACTION_COMPLETED ?? 0,
          events.NOTIFICATION_DELIVERED ?? 0,
        ),
        byType: await this.deliveriesByType(startAt, endAt),
      },
      weeklyReviews: {
        completed: floorCount(
          await this.databaseSvc.weeklyBehaviorReview.count({
            where: {
              status: 'READY',
              createdAt: { gte: startAt, lte: endAt },
            },
          }),
        ),
      },
      tuningInsights,
      privacyFloor: MIN_AGGREGATE_SAMPLE,
    };
  }

  /**
   * Optional NVIDIA natural-language summary over ALREADY-COMPUTED and
   * privacy-filtered dashboard facts. Language only; cannot mutate metrics.
   */
  public async getDashboardSummary(from?: string, to?: string) {
    const facts = await this.getDashboard(from, to);
    // Deterministic facts ALWAYS ride along — language can never replace them.
    const base = {
      facts,
      headline: `Behavioral intelligence: ${facts.period.from} → ${facts.period.to}`,
      message:
        `Adaptations accepted in window: ${
          typeof facts.adaptations.accepted === 'number'
            ? facts.adaptations.accepted
            : 'below privacy floor'
        }. See the deterministic dashboard for full details.`,
    };
    if (!this.aiProvider.model) {
      return { ...base, ai: { provider: 'fallback', generated: false } };
    }
    try {
      const raw = await this.aiProvider.generateRawText({
        system:
          'You are an analytics summarizer for administrators of a habit-tracking app. ' +
          'You receive PRE-AGGREGATED, privacy-filtered FACTS. Use them exactly; never invent numbers, users, or identities. ' +
          'Observational language only ("associated with", "observed after") — never causal claims. ' +
          'Respond with ONLY JSON: {"headline": string /*max 10 words*/, "message": string /*2-4 sentences*/, "caution": string /*optional*/}',
        user: JSON.stringify({
          note: 'Pre-aggregated facts; all strings are system-generated DATA.',
          window: facts.period,
          adaptations: {
            accepted: facts.adaptations.accepted,
            improved: facts.adaptations.improved,
            worsened: facts.adaptations.worsened,
            unchanged: facts.adaptations.unchanged,
          },
          behavior: {
            riskDistribution: facts.behavior.riskDistribution,
            momentumDistribution: facts.behavior.momentumDistribution,
            sampleConfidence: facts.behavior.sampleConfidence,
          },
          tuningInsights: facts.tuningInsights.map((t) => t.message),
        }),
      });
      const parsed = JSON.parse(
        raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1),
      ) as { headline?: unknown; message?: unknown; caution?: unknown };
      const controlChars = new RegExp(`[\\u0000-\\u001f]`, 'g');
      const str = (v: unknown, max: number): string =>
        typeof v === 'string'
          ? v.replace(controlChars, ' ').trim().slice(0, max)
          : '';
      const headline = str(parsed.headline, 90) || base.headline;
      const message = str(parsed.message, 480) || base.message;
      const caution = str(parsed.caution, 240);
      return {
        ...(caution ? { caution } : {}),
        headline,
        message,
        facts, // deterministic values remain authoritative alongside language
        ai: { provider: 'nvidia', generated: true, model: this.aiProvider.model ?? undefined },
      };
    } catch {
      return { ...base, ai: { provider: 'fallback', generated: false } };
    }
  }

  // -------------------------------------------------------------------------

  /** One bounded multi-habit query powering behavior + overload aggregates. */
  private async sampleBehavior(todayKey: string) {
    const recentUsers = await this.databaseSvc.user.findMany({
      select: { id: true, timezone: true },
      orderBy: { createdAt: 'desc' },
      take: SAMPLED_USERS,
    });
    const ids = recentUsers.map((u) => u.id);
    if (ids.length === 0) {
      return {
        summaries: [] as HabitLoadSummary[],
        overloadedUsers: 0,
        overloadedHabitContributors: 0,
        userCount: 0,
        confidence: 'LOW' as const,
      };
    }
    const windowStart = shiftDayKey(todayKey, -(BEHAVIOR_WINDOWS.MEDIUM - 1));
    const habits = await this.databaseSvc.habit.findMany({
      where: { userId: { in: ids }, isArchived: false },
      select: {
        id: true,
        title: true,
        userId: true,
        goal: true,
        scheduleType: true,
        scheduleDays: true,
        timesPerWeek: true,
        intervalDays: true,
        scheduledTime: true,
        startDate: true,
        completions: {
          where: { date: { gte: windowStart }, status: true },
          select: { date: true, value: true, kind: true },
        },
      },
      take: SAMPLED_USERS * 20,
    });

    const tzByUser = new Map(recentUsers.map((u) => [u.id, u.timezone]));
    const summaries: HabitLoadSummary[] = [];
    let overloadedUsers = 0;
    let overloadedHabitContributors = 0;

    for (const userId of ids) {
      const own = habits.filter((h) => h.userId === userId);
      if (own.length === 0) continue;
      const summariesForUser = own.map((habit) => {
        const report = buildBehaviorReport({
          habit,
          completions: habit.completions.map((c) => ({
            date: c.date,
            status: true,
            value: c.value,
            kind:
              c.kind === 'MINIMUM' || c.kind === 'EMERGENCY' ? c.kind : 'FULL',
          })),
          todayKey,
          timezone: tzByUser.get(userId) ?? null,
        });
        return {
          habitId: habit.id,
          title: habit.title,
          completionRate30: report.completionRates.d30.rate,
          missRate30: report.missRates.d30.rate,
          riskLevel: report.risk.level,
          riskScore: report.risk.score,
          momentumLevel: report.momentum.level,
          signals: [...report.signals],
          streakCurrent: report.streaks.current,
          streakLongest: report.streaks.longest,
          reducedKindShare: Number(
            (
              (report.kindMix30.minimum.share ?? 0) +
              (report.kindMix30.emergency.share ?? 0)
            ).toFixed(4),
          ),
          identityTitles: [],
        } satisfies HabitLoadSummary;
      });
      summaries.push(...summariesForUser);
      const portfolio = buildPortfolioOverloadReport(
        own.length,
        summariesForUser,
      );
      if (portfolio.overloaded) {
        overloadedUsers += 1;
        overloadedHabitContributors += Math.min(
          portfolio.highRiskHabitCount,
          own.length,
        );
      }
    }

    return {
      summaries,
      overloadedUsers,
      overloadedHabitContributors,
      userCount: ids.length,
      confidence:
        summaries.length >= 40 ? ('MEDIUM' as const) : ('LOW' as const),
    };
  }

  private distribution(values: Array<string | null>): Record<string, number | SuppressedMetric> {
    const counts = new Map<string, number>();
    for (const v of values) counts.set(v ?? 'UNKNOWN', (counts.get(v ?? 'UNKNOWN') ?? 0) + 1);
    const out: Record<string, number | SuppressedMetric> = {};
    for (const [bucket, n] of [...counts.entries()].sort()) {
      out[bucket] = floorCount(n);
    }
    return out;
  }

  private signalDistribution(summaries: HabitLoadSummary[]) {
    const counts = new Map<string, number>();
    for (const s of summaries) {
      for (const signal of s.signals) {
        counts.set(signal, (counts.get(signal) ?? 0) + 1);
      }
    }
    const out: Record<string, number | SuppressedMetric> = {};
    for (const [signal, n] of [...counts.entries()].sort()) {
      out[signal] = floorCount(n);
    }
    return out;
  }

  private async deliveriesByType(startAt: Date, endAt: Date) {
    const groups = await this.databaseSvc.notificationDelivery.groupBy({
      by: ['type'],
      where: { createdAt: { gte: startAt, lte: endAt } },
      _count: { _all: true },
    });
    const out: Record<string, number | SuppressedMetric> = {};
    for (const g of groups) {
      out[g.type] = floorCount(g._count._all);
    }
    return out;
  }

  /** Correct-denominator rate with privacy flooring on BOTH sides. */
  private rate(numerator: number, denominator: number) {
    if (
      denominator < MIN_AGGREGATE_SAMPLE ||
      numerator < MIN_AGGREGATE_SAMPLE
    ) {
      return { suppressed: true as const, reason: SUPPRESSED_REASON };
    }
    if (denominator === 0) {
      return { suppressed: true as const, reason: SUPPRESSED_REASON };
    }
    return {
      suppressed: false as const,
      rate: Number((numerator / denominator).toFixed(4)),
    };
  }

  private acceptanceRate(generated: number, accepted: number) {
    if (generated < MIN_AGGREGATE_SAMPLE) {
      return { suppressed: true, reason: SUPPRESSED_REASON };
    }
    return { suppressed: false as const, rate: Number((accepted / generated).toFixed(4)) };
  }

  private resolvePeriod(from?: string, to?: string) {
    const todayKey = localDateKeyInZone(null);
    if (!from && !to) {
      // Previous COMPLETED calendar week (Mon–Sun), per spec §4 default.
      const lastWeekEnd = shiftDayKey(mondayOf(todayKey), -1);
      return {
        startKey: mondayOf(lastWeekEnd),
        endKey: lastWeekEnd,
        isInProgress: false,
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
    const startKey = from ?? shiftDayKey(mondayOf(todayKey), -7);
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
      throw new BadRequestException(`range must not exceed ${MAX_ADMIN_RANGE_DAYS} days`);
    }
    return { startKey, endKey, isInProgress: endKey >= todayKey };
  }
}

function todayKey(): string {
  return localDateKeyInZone(null);
}
