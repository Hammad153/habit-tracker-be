import { Injectable, Logger } from '@nestjs/common';
import {
  CompletionKind,
  IdentityStatus,
  Prisma,
  RewardLedger,
  RewardTransactionType,
} from '@prisma/client';
import { COINS_PER_COMPLETION, MAX_IDENTITY_LEVEL, STREAK_MILESTONE_BONUSES, DEFAULT_STREAK_MILESTONE_BONUS } from '../../core/utils/evidence.constants';
import { IDENTITY_LEVEL_THRESHOLDS } from '../../core/utils/evidence.utils';
import {
  computeCurrentStreak,
  isMilestoneCycleIntact,
} from '../../core/utils/streak-milestone.utils';

type Tx = Prisma.TransactionClient;

export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100] as const;
// Legacy constant kept for backward compatibility – use STREAK_MILESTONE_BONUSES instead
export const STREAK_MILESTONE_BONUS = 25;
export const IDENTITY_MILESTONE_BONUS = 20;

/** Identity evidence thresholds that pay a one-time coin bonus (levels 2..max). */
export const IDENTITY_MILESTONE_THRESHOLDS = IDENTITY_LEVEL_THRESHOLDS.slice(
  1,
  MAX_IDENTITY_LEVEL,
);

const streakMilestoneKey = (
  habitId: string,
  milestone: number,
  cycleStart: string,
) => `sm:${habitId}:${milestone}:${cycleStart}`;

const identityMilestoneKey = (identityId: string, threshold: number) =>
  `im:${identityId}:${threshold}`;

/** Parses "sm:<habitId>:<milestone>:<cycleStart>" ledger keys. */
const parseStreakMilestoneKey = (
  key: string,
): { habitId: string; milestone: number; cycleStart: string } | null => {
  const parts = key.split(':');
  if (parts.length !== 4 || parts[0] !== 'sm') return null;
  const milestone = Number(parts[2]);
  if (!Number.isInteger(milestone)) return null;
  return { habitId: parts[1], milestone, cycleStart: parts[3] };
};

export interface RewardRuleOverrides {
  fullCoins?: number | null;
  minimumCoins?: number | null;
  emergencyCoins?: number | null;
  streakBonusEnabled?: boolean | null;
  identityBonusEnabled?: boolean | null;
}

export interface CompletionRewardContext {
  userId: string;
  habitId: string;
  completionId: string;
  kind: CompletionKind;
  date: string; // client-local YYYY-MM-DD
  habitTitle?: string;
  rules?: RewardRuleOverrides;
}

export interface RewardLine {
  code: 'BASE' | 'STREAK_MILESTONE' | 'IDENTITY_MILESTONE';
  label: string;
  amount: number;
}

export interface RewardBreakdown {
  total: number;
  lines: RewardLine[];
  streak: number;
  newStreakMilestones: number[];
  newIdentityMilestones: Array<{ identityId: string; threshold: number }>;
}

/**
 * Central behavioral reward calculation. Every completion path (habit toggle
 * and daily plan) goes through this service so base rewards, streak
 * milestones and identity milestones behave identically everywhere.
 *
 * Persistence stays in the RewardLedger; this engine never touches User.coins
 * outside the caller's transaction.
 */
@Injectable()
export class RewardEngineService {
  private readonly logger = new Logger(RewardEngineService.name);

  /** Base coins for a completion kind, honoring per-habit overrides. */
  public baseCoinsForKind(
    kind: CompletionKind,
    rules?: RewardRuleOverrides,
  ): number {
    const defaults = COINS_PER_COMPLETION[kind] ?? 0;
    if (!rules) return defaults;
    const override =
      kind === 'FULL'
        ? rules.fullCoins
        : kind === 'MINIMUM'
          ? rules.minimumCoins
          : rules.emergencyCoins;
    if (override === null || override === undefined) return defaults;
    return Math.max(0, Math.trunc(override));
  }

  /**
   * Awards everything a successful completion transition earns:
   * base coins + any newly reached streak/identity milestones.
   * Must run inside the completion's transaction. Idempotent by construction:
   * milestone claims use unique deterministic ledger keys.
   */
  public async awardForCompletionTx(
    tx: Tx,
    ctx: CompletionRewardContext,
  ): Promise<RewardBreakdown> {
    const lines: RewardLine[] = [];
    let total = 0;

    // ---- Base reward ----
    const base = this.baseCoinsForKind(ctx.kind, ctx.rules);
    if (base > 0) {
      await this.createAward(tx, ctx.userId, {
        amount: base,
        type:
          ctx.kind === 'FULL'
            ? 'HABIT_COMPLETION'
            : ctx.kind === 'MINIMUM'
              ? 'HABIT_MINIMUM_COMPLETION'
              : 'HABIT_EMERGENCY_COMPLETION',
        referenceType: 'COMPLETION',
        referenceId: ctx.completionId,
        description: ctx.habitTitle
          ? `Completed ${ctx.kind.toLowerCase()}: ${ctx.habitTitle}`
          : undefined,
      });
      lines.push({ code: 'BASE', label: 'Habit completion', amount: base });
      total += base;
    }

    // ---- Streak milestone bonus ----
    let streak = 0;
    const newMilestones: number[] = [];
    if (ctx.rules?.streakBonusEnabled !== false && base > 0) {
      const claim = await this.claimStreakMilestones(tx, ctx);
      streak = claim.streak;
      for (const m of claim.awarded) {
        lines.push({
          code: 'STREAK_MILESTONE',
          label: `${m}-day streak`,
          amount: STREAK_MILESTONE_BONUS,
        });
        total += STREAK_MILESTONE_BONUS;
        newMilestones.push(m);
      }
    }

    // ---- Identity milestone bonus ----
    const newIdentityMilestones: Array<{
      identityId: string;
      threshold: number;
    }> = [];
    if (ctx.rules?.identityBonusEnabled !== false && base > 0) {
      const identityAwards = await this.claimIdentityMilestones(tx, ctx);
      for (const award of identityAwards) {
        lines.push({
          code: 'IDENTITY_MILESTONE',
          label: `Identity level ${award.threshold} evidence`,
          amount: IDENTITY_MILESTONE_BONUS,
        });
        total += IDENTITY_MILESTONE_BONUS;
        newIdentityMilestones.push(award);
      }
    }

    return { total, lines, streak, newStreakMilestones: newMilestones, newIdentityMilestones };
  }

  /**
   * Reverses what a completion had earned after it is removed or downgraded:
   * the base grant plus any streak-milestone bonus whose cycle is no longer
   * intact. Identity milestones are one-time and intentionally NOT reversed
   * (evidence history persists; see Phase 2 report).
   */
  public async reverseCompletionRewardsTx(
    tx: Tx,
    ctx: {
      userId: string;
      habitId: string;
      completionId: string;
      priorKind: CompletionKind;
    },
  ): Promise<number> {
    let reversed = 0;

    reversed += await this.reverseBaseAward(tx, ctx.userId, ctx.completionId, ctx.priorKind);

    // Streak bonuses whose cycle broke.
    const completedKeys = await this.recentCompletedKeys(tx, ctx.habitId);
    const frozenKeys = await this.frozenKeysForHabit(tx, ctx.habitId);
    const awards = await tx.rewardLedger.findMany({
      where: {
        userId: ctx.userId,
        type: 'STREAK_MILESTONE',
        reversalOfId: null,
        idempotencyKey: { startsWith: `sm:${ctx.habitId}:` },
      },
      select: { id: true, idempotencyKey: true, amount: true },
    });
    for (const entry of awards) {
      const parsed = parseStreakMilestoneKey(entry.idempotencyKey ?? '');
      if (!parsed || parsed.habitId !== ctx.habitId) continue;
      const intact = isMilestoneCycleIntact(
        completedKeys,
        parsed.cycleStart,
        parsed.milestone,
        frozenKeys,
      );
      if (intact) continue;
      reversed += await this.reverseEntryOnce(tx, ctx.userId, entry);
    }

    return reversed;
  }

  /**
   * Current-streak lookup used by feedback endpoints. Bounded to the most
   * recent completions — never a full-history scan.
   */
  public async getCurrentStreak(
    tx: Tx,
    habitId: string,
  ): Promise<{ streak: number; cycleStart: string }> {
    const keys = await this.recentCompletedKeys(tx, habitId);
    if (keys.length === 0) return { streak: 0, cycleStart: '' };
    const latest = keys.reduce((a, b) => (a > b ? a : b));
    const frozen = await this.frozenKeysForHabit(tx, habitId);
    return computeCurrentStreak(keys, latest, frozen);
  }

  private async claimStreakMilestones(
    tx: Tx,
    ctx: CompletionRewardContext,
  ): Promise<{ streak: number; awarded: number[] }> {
    const completedKeys = await this.recentCompletedKeys(tx, ctx.habitId);
    const frozenKeys = await this.frozenKeysForHabit(tx, ctx.habitId);
    const { streak, cycleStart } = computeCurrentStreak(
      completedKeys,
      ctx.date,
      frozenKeys,
    );
    if (streak === 0) return { streak, awarded: [] };

    const claimed = await tx.rewardLedger.findMany({
      where: {
        userId: ctx.userId,
        type: 'STREAK_MILESTONE',
        idempotencyKey: { startsWith: `sm:${ctx.habitId}:` },
      },
      select: { idempotencyKey: true },
    });
    const claimedSet = new Set(claimed.map((c) => c.idempotencyKey));

    const awarded: number[] = [];
    for (const m of STREAK_MILESTONES) {
      if (streak < m) break;
      const key = streakMilestoneKey(ctx.habitId, m, cycleStart);
      if (claimedSet.has(key)) continue;
      const bonus = STREAK_MILESTONE_BONUSES[m] ?? DEFAULT_STREAK_MILESTONE_BONUS;
      try {
        await this.createAward(tx, ctx.userId, {
          amount: bonus,
          type: 'STREAK_MILESTONE',
          referenceType: 'STREAK_MILESTONE',
          referenceId: `${ctx.habitId}:${m}`,
          idempotencyKey: key,
          description: `${m}-day streak on ${ctx.habitTitle ?? ctx.habitId}`,
        });
        awarded.push(m);
      } catch (err) {
        if ((err as Prisma.PrismaClientKnownRequestError)?.code === 'P2002') {
          continue; // concurrent claim won; fine
        }
        throw err;
      }
    }
    return { streak, awarded };
  }

  private async claimIdentityMilestones(
    tx: Tx,
    ctx: CompletionRewardContext,
  ): Promise<Array<{ identityId: string; threshold: number }>> {
    const links = await tx.identityHabit.findMany({
      where: { habitId: ctx.habitId },
      select: { identityId: true },
    });
    if (links.length === 0) return [];

    const identities = await tx.identity.findMany({
      where: {
        id: { in: links.map((l) => l.identityId) },
        userId: ctx.userId,
        status: IdentityStatus.ACTIVE,
      },
      select: { id: true },
    });
    if (identities.length === 0) return [];

    const habitIds = await tx.identityHabit.findMany({
      where: { identityId: { in: identities.map((i) => i.id) } },
      select: { habitId: true, identityId: true },
    });
    const habitsPerIdentity = new Map<string, string[]>();
    for (const row of habitIds) {
      habitsPerIdentity.set(row.identityId, [
        ...(habitsPerIdentity.get(row.identityId) ?? []),
        row.habitId,
      ]);
    }

    const alreadyClaimed = await tx.rewardLedger.findMany({
      where: {
        userId: ctx.userId,
        type: 'IDENTITY_MILESTONE',
        idempotencyKey: {
          in: identities.flatMap((i) =>
            IDENTITY_MILESTONE_THRESHOLDS.map((t) => identityMilestoneKey(i.id, t)),
          ),
        },
      },
      select: { idempotencyKey: true },
    });
    const claimedSet = new Set(alreadyClaimed.map((c) => c.idempotencyKey));

    const awarded: Array<{ identityId: string; threshold: number }> = [];
    for (const identity of identities) {
      const linkedHabits = habitsPerIdentity.get(identity.id) ?? [];
      if (linkedHabits.length === 0) continue;
      const grouped = await tx.completion.groupBy({
        by: ['kind'],
        where: { habitId: { in: linkedHabits }, status: true },
        _count: { _all: true },
      });
      const points = grouped.reduce(
        (sum, g) =>
          sum +
          g._count._all *
            (g.kind === 'FULL' ? 2 : 1),
        0,
      );

      for (const threshold of IDENTITY_MILESTONE_THRESHOLDS) {
        if (points < threshold) continue;
        const key = identityMilestoneKey(identity.id, threshold);
        if (claimedSet.has(key)) continue;
        try {
          await this.createAward(tx, ctx.userId, {
            amount: IDENTITY_MILESTONE_BONUS,
            type: 'IDENTITY_MILESTONE',
            referenceType: 'IDENTITY_MILESTONE',
            referenceId: identity.id,
            idempotencyKey: key,
            description: `Identity evidence reached ${threshold}`,
          });
          awarded.push({ identityId: identity.id, threshold });
        } catch (err) {
          if ((err as Prisma.PrismaClientKnownRequestError)?.code === 'P2002') {
            continue;
          }
          throw err;
        }
      }
    }
    return awarded;
  }

  private async reverseBaseAward(
    tx: Tx,
    userId: string,
    completionId: string,
    priorKind: CompletionKind,
  ): Promise<number> {
    const type: RewardTransactionType =
      priorKind === 'FULL'
        ? 'HABIT_COMPLETION'
        : priorKind === 'MINIMUM'
          ? 'HABIT_MINIMUM_COMPLETION'
          : 'HABIT_EMERGENCY_COMPLETION';
    const original = await tx.rewardLedger.findFirst({
      where: {
        userId,
        type,
        referenceType: 'COMPLETION',
        referenceId: completionId,
        reversalOfId: null,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!original || original.amount <= 0) return 0;
    return this.reverseEntryOnce(tx, userId, original);
  }

  /** Shared single-reversal primitive (unique reversalOfId makes retries no-ops). */
  public async reverseEntryOnce(
    tx: Tx,
    userId: string,
    original: Pick<RewardLedger, 'id' | 'amount'>,
  ): Promise<number> {
    try {
      await tx.rewardLedger.create({
        data: {
          userId,
          amount: -original.amount,
          type: 'REVERSAL',
          referenceType: 'LEDGER_ENTRY',
          referenceId: original.id,
          reversalOfId: original.id,
        },
      });
    } catch (err) {
      if ((err as Prisma.PrismaClientKnownRequestError)?.code === 'P2002') {
        return 0;
      }
      throw err;
    }
    await tx.user.update({
      where: { id: userId },
      data: { coins: { decrement: original.amount } },
      select: { coins: true },
    });
    return original.amount;
  }

  /** Creates an award entry and bumps the cached balance atomically. */
  private async createAward(
    tx: Tx,
    userId: string,
    data: {
      amount: number;
      type: RewardTransactionType;
      referenceType: string;
      referenceId: string;
      idempotencyKey?: string;
      description?: string;
    },
  ): Promise<void> {
    await tx.rewardLedger.create({
      data: {
        userId,
        amount: data.amount,
        type: data.type,
        referenceType: data.referenceType,
        referenceId: data.referenceId,
        ...(data.idempotencyKey ? { idempotencyKey: data.idempotencyKey } : {}),
        description: data.description,
      },
    });
    await tx.user.update({
      where: { id: userId },
      data: { coins: { increment: data.amount } },
    });
  }

  /** Bounded recent completed day keys (enough for a 100-day milestone). */
  private async recentCompletedKeys(tx: Tx, habitId: string): Promise<string[]> {
    const rows = await tx.completion.findMany({
      where: { habitId, status: true },
      orderBy: { date: 'desc' },
      take: 400,
      select: { date: true },
    });
    return rows.map((r) => r.date);
  }

  private async frozenKeysForHabit(tx: Tx, habitId: string): Promise<string[]> {
    const rows = await tx.streakFreeze.findMany({
      where: { habitId },
      select: { date: true },
    });
    return rows.map((r) => r.date);
  }
}
