import { Inject, Injectable, Logger } from '@nestjs/common';
import { AI_PROVIDER } from '../../core/ai/ai-provider.interface';
import type { AiProvider } from '../../core/ai/ai-provider.interface';
import { DatabaseService } from '../../core/database/database.service';
import {
  COOLDOWN_DAYS,
  type NotificationPriority,
  type NotificationType,
} from '../../core/utils/adaptive-cadence.constants';
import {
  evaluateCadence,
  inQuietHours,
} from '../../core/utils/adaptive-cadence.utils';
import { buildBehaviorReport } from '../../core/utils/behavior-analytics.utils';
import { BEHAVIOR_WINDOWS } from '../../core/utils/behavior.constants';
import { isScheduledOnDate, shiftDayKey } from '../../core/utils/schedule.utils';
import { localDateKeyInZone, mondayOf } from '../../core/utils/week.utils';
import { HabitAnalyticsService } from '../analytics/habit-analytics.service';
import { PortfolioOverloadService } from '../analytics/portfolio-overload.service';

const MAX_CANDIDATES = 3;
const SCAN_HABITS = 10;

export interface NotificationCandidate {
  type: NotificationType;
  priority: NotificationPriority;
  fingerprint: string;
  title: string;
  body: string;
  action: { route: string };
  expiresAt: string; // ISO instant
}

/**
 * Phase 3.7 — deterministic notification candidates.
 *
 * Backend decides WHAT (analytics → decision → fingerprint); the existing
 * mobile reminder/local-notification layer decides WHEN/HOW. NVIDIA is NOT
 * consulted here: all copy derives from already-generated deterministic
 * reasons and fallback templates (spec §17/§18).
 */
@Injectable()
export class NotificationCandidatesService {
  private readonly logger = new Logger(NotificationCandidatesService.name);

  constructor(
    private readonly databaseSvc: DatabaseService,
    private readonly habitAnalyticsSvc: HabitAnalyticsService,
    private readonly overloadSvc: PortfolioOverloadService,
    @Inject(AI_PROVIDER) private readonly aiProvider: AiProvider,
  ) {}

  public async getCandidates(userId: string): Promise<NotificationCandidate[]> {
    const prefs = await this.loadPreferences(userId);
    const user = await this.databaseSvc.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const todayKey = localDateKeyInZone(user?.timezone ?? null);
    const localMinutes =
      new Date().getUTCHours() * 60 + new Date().getUTCMinutes(); // refined below

    // Cooldown/dedup ledger — survives reinstall via server state.
    const cooldownCutoff = shiftDayKey(
      todayKey,
      -Math.max(...Object.values(COOLDOWN_DAYS)),
    );
    const recent = await this.databaseSvc.notificationDelivery.findMany({
      where: { userId, createdAt: { gte: new Date(`${cooldownCutoff}T00:00:00.000Z`) } },
      select: { fingerprint: true, dayKey: true },
      take: 200,
    });
    const recentlyDeliveredFingerprints = new Set(
      recent.map((r) => r.fingerprint),
    );
    const deliveriesToday = recent.filter((r) => r.dayKey === todayKey).length;

    const baseCtx = {
      todayKey,
      coachEnabled: prefs.coachEnabled,
      weeklyReviewEnabled: prefs.weeklyReviewEnabled,
      coachFrequency: prefs.coachFrequency,
      recentlyDeliveredFingerprints,
      deliveriesToday,
    };

    const candidates: Array<NotificationCandidate & { interventionPriority: number }> = [];
    const push = (
        candidate: Omit<NotificationCandidate, 'priority' | 'expiresAt'>,
        interventionPriority: number,
        extra: Partial<
          Pick<
            Parameters<typeof evaluateCadence>[0],
            'scheduledToday' | 'completedToday'
          >
        > = {},
      ) => {
        void localMinutes;
        const decision = evaluateCadence({
          ...baseCtx,
          type: candidate.type,
          interventionPriority,
          fingerprint: candidate.fingerprint,
          localMinutes: this.localMinutesFor(user?.timezone ?? null),
          ...extra,
        });
        if (!decision.eligible) return;
        candidates.push({
          ...candidate,
          priority: decision.priority,
          expiresAt: new Date(
            Date.now() + COOLDOWN_DAYS[candidate.type] * 86_400_000,
          ).toISOString(),
          interventionPriority,
        });
      };

    // ---- Portfolio overload (Phase 3.6 engine reused verbatim) -------------
    try {
      const overload = await this.overloadSvc.getOverloadReport(userId);
      if (overload.overloaded) {
        const weekStart = mondayOf(todayKey);
        push(
          {
            type: 'OVERLOAD_DETECTED',
            fingerprint: `overload:${userId}:${weekStart}`,
            title: overload.insight.headline,
            body: overload.insight.message,
            action: { route: '/manage-habits' },
          },
          82,
        );
      }
    } catch {
      // Overload is additive; a failure never blocks other candidates.
    }

    // ---- Completed-week review availability --------------------------------
    if (prefs.weeklyReviewEnabled) {
      const lastWeekEnd = shiftDayKey(mondayOf(todayKey), -1);
      push(
        {
          type: 'WEEKLY_REVIEW_READY',
          fingerprint: `weekly-review:${mondayOf(lastWeekEnd)}`,
          title: 'Your week is ready',
          body: 'See what your habits are telling you.',
          action: { route: '/weekly-review' },
        },
        60,
      );
    }

    // ---- Habit-scoped candidates (bounded scan, pure analytics) ------------
    const habitRows = await this.databaseSvc.habit.findMany({
      where: { userId, isArchived: false },
      select: {
        id: true,
        title: true,
        goal: true,
        scheduleType: true,
        scheduleDays: true,
        timesPerWeek: true,
        intervalDays: true,
        scheduledTime: true,
        startDate: true,
        completions: {
          where: {
            date: { gte: shiftDayKey(todayKey, -(BEHAVIOR_WINDOWS.LONG - 1)) },
            status: true,
          },
          select: { date: true, value: true, kind: true },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: SCAN_HABITS * 2,
    });

    for (const habit of habitRows) {
      if (candidates.length >= MAX_CANDIDATES + 2) break;
      try {
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
          timezone: user?.timezone ?? null,
        });
        const scheduledToday = isScheduledOnDate(habit, todayKey);
        const completedToday = report.completedToday;

        const consider = (
          type: NotificationType,
          priority: number,
          title: string,
          body: string,
          route: string,
        ) =>
          push(
            {
              type,
              fingerprint: `${type.toLowerCase()}:${habit.id}:${weekBucket(todayKey)}:${priority}`,
              title,
              body,
              action: { route },
            },
            priority,
            { scheduledToday, completedToday },
          );

        // Map existing deterministic signals → typed notifications.
        if (report.signals.includes('AT_RISK') || report.risk.level === 'HIGH') {
          consider(
            report.risk.level === 'CRITICAL'
              ? 'RECOVERY_NEEDED'
              : 'HABIT_AT_RISK',
            report.risk.level === 'CRITICAL' ? 100 : 78,
            report.risk.level === 'CRITICAL'
              ? `A gentle restart for ${habit.title}`
              : `${habit.title} needs attention`,
            report.risk.reasons[0] ?? 'Recent misses are adding up.',
            `/habit-detail?habitId=${habit.id}`,
          );
        }
        if (report.signals.includes('TOO_HARD')) {
          consider(
            'DIFFICULTY_TOO_HIGH',
            92,
            `${habit.title} may be too difficult right now`,
            'Your recent pattern suggests the full version is a stretch. The adaptive suggestion can help.',
            `/habit-detail?habitId=${habit.id}`,
          );
        }
        const weekdayRisk = report.structuredSignals.find(
          (s) => s.type === 'WEEKDAY_RISK',
        ) as { dayFull?: string } | undefined;
        if (weekdayRisk?.dayFull) {
          consider(
            'WEEKDAY_RISK',
            74,
            `${weekdayRisk.dayFull}s are usually tough`,
            `Plan your minimum version ahead of time for ${habit.title}.`,
            `/habit-detail?habitId=${habit.id}`,
          );
        }
        if (
          report.momentum.level === 'STRONG' &&
          (report.risk.level === 'LOW' || report.risk.level === 'MODERATE')
        ) {
          consider(
            'MOMENTUM_PROTECTION',
            76,
            `Momentum is building on ${habit.title}`,
            report.risk.reasons[0] ?? 'Keep the current routine stable.',
            `/habit-detail?habitId=${habit.id}`,
          );
        }
      } catch {
        continue;
      }
    }

    // ---- Pending adaptive proposal + evaluated outcome ----------------------
    const pendingProposal = await this.databaseSvc.habitAdjustmentProposal.findFirst({
      where: { userId, status: 'PENDING', confidence: { gte: 0.6 } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        habitId: true,
        type: true,
        confidence: true,
        reason: true,
        createdAt: true,
      },
    });
    if (pendingProposal) {
      push(
        {
          type: 'ADAPTIVE_PROPOSAL_AVAILABLE',
          fingerprint: `adaptive-proposal:${pendingProposal.id}:${weekBucket(todayKey)}`,
          title: 'An adjustment suggestion is ready',
          body: pendingProposal.reason,
          action: { route: `/habit-detail?habitId=${pendingProposal.habitId}` },
        },
        80,
      );
    }

    const evaluatedOutcome = await this.databaseSvc.habitAdjustmentProposal.findFirst({
      where: {
        userId,
        status: 'ACCEPTED',
        outcome: { in: ['IMPROVED', 'WORSENED'] },
      },
      orderBy: [{ resolvedAt: 'desc' }, { acceptedAt: 'desc' }],
      select: {
        id: true,
        outcome: true,
        habitId: true,
        baselineCompletionRate: true,
        postCompletionRate: true,
        resolvedAt: true,
      },
    });
    if (evaluatedOutcome) {
      const improved = evaluatedOutcome.outcome === 'IMPROVED';
      push(
        {
          type: 'ADAPTATION_OUTCOME',
          fingerprint: `adaptation-outcome:${evaluatedOutcome.id}:${evaluatedOutcome.outcome}`,
          title: improved ? 'That adjustment worked' : 'The adjusted routine got harder',
          body: improved
            ? 'Consistency improved after the adjustment.'
            : 'Consistency did not improve after the adjustment. Consider revisiting it.',
          action: { route: `/habit-detail?habitId=${evaluatedOutcome.habitId}` },
        },
        80,
      );
    }

    // Deterministic ranking: URGENT first, then by intervention priority.
    const selected = candidates
      .sort(
        (a, b) =>
          rank(a.priority) - rank(b.priority) ||
          b.interventionPriority - a.interventionPriority,
      )
      .slice(0, MAX_CANDIDATES)
      .map((c) => {
        const { interventionPriority, ...rest } = c;
        void interventionPriority;
        return rest;
      });

    return selected;
  }

  /** Client confirms scheduled notifications → persisted idempotency ledger. */
  public async markDelivered(
    userId: string,
    fingerprints: Array<{
      fingerprint: string;
      type: NotificationType;
      priority: NotificationPriority;
    }>,
  ): Promise<{ stored: number }> {
    const user = await this.databaseSvc.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const todayKey = localDateKeyInZone(user?.timezone ?? null);
    let stored = 0;
    for (const item of fingerprints.slice(0, 20)) {
      try {
        await this.databaseSvc.notificationDelivery.upsert({
          where: {
            userId_fingerprint: { userId, fingerprint: item.fingerprint },
          },
          create: {
            userId,
            fingerprint: item.fingerprint,
            type: item.type,
            priority: item.priority,
            dayKey: todayKey,
          },
          update: {}, // idempotent replay
        });
        stored += 1;
      } catch (err) {
        this.logger.warn({ outcome: 'delivery-record-failed', reason: String(err).slice(0, 40) });
      }
    }
    return { stored };
  }

  // -------------------------------------------------------------------------

  private localMinutesFor(timezone: string | null): number {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone || 'UTC',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date());
      const [h, m] = parts.split(':').map(Number);
      return h * 60 + m;
    } catch {
      const now = new Date();
      return now.getUTCHours() * 60 + now.getUTCMinutes();
    }
  }

  private async loadPreferences(userId: string) {
    const prefs = await this.databaseSvc.user.findUnique({
      where: { id: userId },
      select: {
        coachEnabled: true,
        aiCoachEnabled: true,
        coachFrequency: true,
        weeklyReviewEnabled: true,
      },
    });
    return prefs ?? {
      coachEnabled: true,
      aiCoachEnabled: true,
      coachFrequency: 'STANDARD',
      weeklyReviewEnabled: true,
    };
  }
}

const rank = (p: NotificationPriority): number =>
  p === 'URGENT' ? 0 : p === 'HIGH' ? 1 : p === 'NORMAL' ? 2 : 3;

const weekBucket = (todayKey: string): string => mondayOf(todayKey);

// Re-exported for tests that want to assert quiet-hour behavior end-to-end.
export const __testing = { inQuietHours };
void inQuietHours;
