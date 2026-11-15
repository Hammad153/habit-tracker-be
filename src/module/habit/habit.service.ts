import { CompletionKind, Completion, Prisma, Habit, HabitBurial, HabitLifecycleStatus } from '@prisma/client';
import { INTERACTIVE_TX_OPTIONS } from '../../core/database/transaction-options';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../core/database/database.service';
import { ProfileService } from '../profile/profile.service';
import { AwardsService } from '../awards/awards.service';
import {
  RewardEngineService,
  RewardBreakdown,
} from '../rewards/reward-engine.service';
import { DomainEventService } from '../../core/events/domain-event.service';
import { XP_PER_COMPLETION } from '../../core/utils/progression.utils';
import { EVIDENCE_POINTS } from '../../core/utils/evidence.utils';
import { longestStreakFromDates } from '../../core/utils/behavior-analytics.utils';
import { BuryHabitDto } from './dto/bury-habit.dto';
import { SetCompletionDto } from './dto/set-completion.dto';
import {
  wouldCreateStackCycle,
  StackEdge,
} from '../../core/utils/stack.utils';

type Tx = Prisma.TransactionClient;

/** Extra completion-response fields consumed by newer clients. */
export interface CompletionResult extends Completion {
  rewards?: {
    coinsAwarded: number;
    kind: CompletionKind;
    breakdown?: RewardBreakdown['lines'];
    streak?: number;
    newStreakMilestones?: number[];
    newIdentityMilestones?: RewardBreakdown['newIdentityMilestones'];
  };
  identityEvidence?: {
    identities: Array<{ id: string; title: string; evidencePoints: number }>;
  };
}

@Injectable()
export class HabitService {
  constructor(
    private databaseSvc: DatabaseService,
    private profileSvc: ProfileService,
    private awardsSvc: AwardsService,
    private rewardEngine: RewardEngineService,
    private domainEvents: DomainEventService,
  ) {}

  /** Burials are explicit, immutable snapshots. A command ID makes retries safe. */
  public async buryHabit(userId: string, habitId: string, input: BuryHabitDto): Promise<HabitBurial> {
    return this.databaseSvc.$transaction(async (tx) => {
      const existing = await tx.habitBurial.findUnique({
        where: { userId_commandId: { userId, commandId: input.commandId } },
      });
      if (existing) {
        if (existing.habitId !== habitId) throw new ConflictException('Command ID belongs to another habit');
        return existing;
      }
      const habit = await tx.habit.findFirst({ where: { id: habitId, userId } });
      if (!habit) throw new NotFoundException('Habit not found');
      if (habit.lifecycleStatus !== 'ACTIVE' && habit.lifecycleStatus !== 'PAUSED') {
        throw new ConflictException('Only active or paused habits can be buried');
      }
      const changed = await tx.habit.updateMany({
        where: { id: habitId, userId, version: habit.version, lifecycleStatus: habit.lifecycleStatus },
        data: { lifecycleStatus: 'BURIED', isArchived: true, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ConflictException('Habit changed; reload and retry');
      const completions = await tx.completion.findMany({
        where: { habitId, status: true }, select: { date: true }, orderBy: { date: 'asc' },
      });
      const dates = completions.map((item) => item.date);
      const reminder = await tx.reminder.findFirst({ where: { habitId, enabled: true } });
      await tx.reminder.updateMany({ where: { habitId, enabled: true }, data: { enabled: false } });
      const sequence = (await tx.habitBurial.count({ where: { habitId } })) + 1;
      const burial = await tx.habitBurial.create({ data: {
        id: input.commandId, userId, habitId, commandId: input.commandId, sequence,
        title: habit.title, habitCreatedAt: habit.createdAt,
        lastCompletedDay: dates.at(-1) ?? null, totalCompletions: dates.length,
        bestStreak: longestStreakFromDates(dates),
        reason: input.reason?.trim() || null,
        epitaph: input.epitaph?.trim() || 'A promising beginning. A memorable ending.',
        theme: input.theme ?? 'stone', reminderEnabled: !!reminder,
      } });
      await tx.habitLifecycleEvent.create({ data: {
        userId, habitId, fromState: habit.lifecycleStatus, toState: 'BURIED', commandId: input.commandId,
      } });
      return burial;
    }, INTERACTIVE_TX_OPTIONS);
  }

  public async listBurials(userId: string, cursor?: string) {
    return this.databaseSvc.habitBurial.findMany({
      where: { userId }, orderBy: [{ buriedAt: 'desc' }, { id: 'desc' }], take: 30,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
  }

  public async getBurial(userId: string, burialId: string) {
    const burial = await this.databaseSvc.habitBurial.findFirst({ where: { id: burialId, userId } });
    if (!burial) throw new NotFoundException('Burial not found');
    return burial;
  }

  public async burialHistory(userId: string, habitId: string) {
    await this.findOne(habitId, userId);
    return this.databaseSvc.habitBurial.findMany({ where: { userId, habitId }, orderBy: { buriedAt: 'desc' } });
  }

  public async restoreBurial(userId: string, burialId: string) {
    return this.databaseSvc.$transaction(async (tx) => {
      const burial = await tx.habitBurial.findFirst({ where: { id: burialId, userId } });
      if (!burial) throw new NotFoundException('Burial not found');
      if (burial.restoredAt) return tx.habit.findUniqueOrThrow({ where: { id: burial.habitId } });
      if (burial.restartHabitId) throw new ConflictException('Burial was restarted');
      const habit = await tx.habit.findFirst({ where: { id: burial.habitId, userId } });
      if (!habit || habit.lifecycleStatus !== 'BURIED') throw new ConflictException('Habit is no longer buried');
      const changed = await tx.habit.updateMany({
        where: { id: habit.id, userId, version: habit.version, lifecycleStatus: 'BURIED' },
        data: { lifecycleStatus: 'ACTIVE', isArchived: false, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ConflictException('Habit changed; reload and retry');
      await tx.habitBurial.update({ where: { id: burialId }, data: { restoredAt: new Date() } });
      if (burial.reminderEnabled) await tx.reminder.updateMany({ where: { habitId: habit.id }, data: { enabled: true } });
      await tx.habitLifecycleEvent.create({ data: { userId, habitId: habit.id, fromState: 'BURIED', toState: 'ACTIVE' } });
      return tx.habit.findUniqueOrThrow({ where: { id: habit.id } });
    }, INTERACTIVE_TX_OPTIONS);
  }

  /** A restart is a new habit with no completions; the tombstone remains. */
  public async restartBurial(userId: string, burialId: string, newHabitId: string) {
    return this.databaseSvc.$transaction(async (tx) => {
      const burial = await tx.habitBurial.findFirst({ where: { id: burialId, userId } });
      if (!burial) throw new NotFoundException('Burial not found');
      if (burial.restartHabitId) {
        if (burial.restartHabitId !== newHabitId) throw new ConflictException('Burial was already restarted');
        return tx.habit.findUniqueOrThrow({ where: { id: newHabitId } });
      }
      if (burial.restoredAt) throw new ConflictException('Burial was restored');
      const prior = await tx.habit.findFirst({ where: { id: burial.habitId, userId } });
      if (!prior || prior.lifecycleStatus !== 'BURIED') throw new ConflictException('Habit is no longer buried');
      const next = await tx.habit.create({ data: {
        id: newHabitId, userId, title: prior.title, subtitle: prior.subtitle, icon: prior.icon,
        iconColor: prior.iconColor, iconBg: prior.iconBg, category: prior.category,
        frequency: prior.frequency, scheduleType: prior.scheduleType,
        scheduleDays: prior.scheduleDays, timesPerWeek: prior.timesPerWeek,
        intervalDays: prior.intervalDays, priority: prior.priority,
        goal: prior.goal, unit: prior.unit, scheduledTime: prior.scheduledTime,
        location: prior.location, fullBehavior: prior.fullBehavior,
        minimumBehavior: prior.minimumBehavior, emergencyMinimum: prior.emergencyMinimum,
        fullCoins: prior.fullCoins, minimumCoins: prior.minimumCoins,
        emergencyCoins: prior.emergencyCoins, streakBonusEnabled: prior.streakBonusEnabled,
        identityBonusEnabled: prior.identityBonusEnabled, rewardFundAmount: prior.rewardFundAmount,
      } });
      await tx.habitBurial.update({ where: { id: burialId }, data: { restartHabitId: next.id } });
      return next;
    }, INTERACTIVE_TX_OPTIONS);
  }

  public async transitionHabit(userId: string, habitId: string, target: HabitLifecycleStatus) {
    if (!['ACTIVE', 'PAUSED', 'ARCHIVED', 'COMPLETED'].includes(target)) {
      throw new BadRequestException('Unsupported lifecycle transition');
    }
    return this.databaseSvc.$transaction(async (tx) => {
      const habit = await tx.habit.findFirst({ where: { id: habitId, userId } });
      if (!habit) throw new NotFoundException('Habit not found');
      const from = habit.lifecycleStatus;
      if (from === target) return habit;
      if (from === 'BURIED' || from === 'EXPIRED' || (target !== 'ACTIVE' && from !== 'ACTIVE')) {
        throw new ConflictException('Invalid lifecycle transition');
      }
      const enabledBefore = target === 'ACTIVE'
        ? (await tx.habitLifecycleEvent.findFirst({
          where: { habitId, userId, toState: from }, orderBy: { createdAt: 'desc' },
        }))?.reminderEnabled ?? false
        : !!(await tx.reminder.findFirst({ where: { habitId, enabled: true } }));
      const changed = await tx.habit.updateMany({
        where: { id: habitId, userId, version: habit.version, lifecycleStatus: from },
        data: { lifecycleStatus: target, isArchived: target === 'ARCHIVED' || target === 'COMPLETED', version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ConflictException('Habit changed; reload and retry');
      if (target === 'ACTIVE' && enabledBefore) {
        await tx.reminder.updateMany({ where: { habitId }, data: { enabled: true } });
      } else if (target !== 'ACTIVE') {
        await tx.reminder.updateMany({ where: { habitId, enabled: true }, data: { enabled: false } });
      }
      await tx.habitLifecycleEvent.create({ data: {
        userId, habitId, fromState: from, toState: target,
        reminderEnabled: target !== 'ACTIVE' && enabledBefore,
      } });
      return tx.habit.findUniqueOrThrow({ where: { id: habitId } });
    }, INTERACTIVE_TX_OPTIONS);
  }

  public async findAll(userId: string): Promise<Habit[]> {
    // Clean up expired habits before returning
    await this.cleanupExpiredHabits();

    return this.databaseSvc.habit.findMany({
      where: { userId },
      include: {
        completions: true,
        identityLinks: {
          include: { identity: { select: { id: true, title: true, color: true, status: true } } },
        },
        stackAfter: { select: { id: true, title: true, icon: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  public async findOne(id: string, userId: string): Promise<Habit> {
    const habit = await this.databaseSvc.habit.findUnique({
      where: { id },
      include: {
        completions: true,
        identityLinks: {
          include: { identity: { select: { id: true, title: true, color: true, status: true } } },
        },
        stackAfter: { select: { id: true, title: true, icon: true } },
        stackedBy: { select: { id: true, title: true, icon: true } },
      },
    });
    if (!habit) throw new NotFoundException(`Habit with ID ${id} not found`);
    if (habit.userId !== userId) {
      // Don't reveal existence of habits owned by other users.
      throw new NotFoundException(`Habit with ID ${id} not found`);
    }
    return habit;
  }

  public async createHabit(userId: string, data: any): Promise<Habit> {
    // userId always comes from the authenticated token; never trust a userId
    // supplied in the request body.
    const habitData = { ...(data ?? {}) } as Record<string, unknown>;
    delete habitData.userId;

    if (typeof habitData.id === 'string') {
      const existing = await this.databaseSvc.habit.findUnique({ where: { id: habitData.id } });
      if (existing) {
        if (existing.userId !== userId) throw new ConflictException('Habit ID is unavailable');
        return existing;
      }
    }

    // Remote DB latency: explicit budgets avoid default-2s maxWait failures.
    return this.databaseSvc.$transaction(
      async (tx) => {
      const { identityIds, ...rest } = habitData;

      const processedData = {
        ...this.parseHabitDates(rest as Record<string, unknown>),
        userId,
      } as Prisma.HabitUncheckedCreateInput & {
        stackAfterHabitId?: string | null;
      };

      if (processedData.stackAfterHabitId) {
        await this.assertStackTarget(
          tx,
          userId,
          processedData.stackAfterHabitId,
          undefined,
        );
      }

      const habit = await tx.habit.create({ data: processedData });

      if (Array.isArray(identityIds) && identityIds.length > 0) {
        await this.linkIdentities(tx, userId, habit.id, identityIds);
      }

      return habit;
      },
      INTERACTIVE_TX_OPTIONS,
    );
  }

  public async updateHabit(
    id: string,
    userId: string,
    data: any,
  ): Promise<Habit> {
    const current = await this.findOne(id, userId); // enforces ownership
    if (current.lifecycleStatus === 'BURIED' && data?.isArchived === false) {
      throw new ConflictException('Restore a buried habit through its burial record');
    }
    const habitData = { ...(data ?? {}) } as Record<string, unknown>;
    delete habitData.userId;
    delete habitData.id;
    delete habitData.expectedVersion;
    if (typeof data?.expectedVersion === 'number' && current.version !== data.expectedVersion) {
      throw new ConflictException('Habit changed; reload and retry');
    }

    // Remote DB latency: explicit budgets avoid default-2s maxWait failures.
    return this.databaseSvc.$transaction(
      async (tx) => {
      const { identityIds, ...rest } = habitData;

      const processedData = this.parseHabitDates(
        rest as Record<string, unknown>,
      ) as Prisma.HabitUncheckedUpdateInput & {
        stackAfterHabitId?: string | null;
      };
      if (typeof data?.isArchived === 'boolean') {
        processedData.lifecycleStatus = data.isArchived ? 'ARCHIVED' : 'ACTIVE';
      }
      processedData.version = { increment: 1 };

      if (processedData.stackAfterHabitId !== undefined) {
        if (processedData.stackAfterHabitId === null) {
          // Explicitly clearing the stack cue is always allowed.
          processedData.stackAfterHabitId = null;
        } else {
          await this.assertStackTarget(
            tx,
            userId,
            processedData.stackAfterHabitId,
            id,
          );
        }
      }

      if (Array.isArray(identityIds)) {
        await this.syncIdentityLinks(tx, userId, id, identityIds);
      }

      return tx.habit.update({
        where: { id, ...(typeof data?.expectedVersion === 'number' ? { version: data.expectedVersion } : {}) },
        data: processedData,
      });
      },
      INTERACTIVE_TX_OPTIONS,
    );
  }

  /**
   * Soft-deletes by archiving when the habit carries history or identity
   * evidence; brand-new unused habits are removed outright. Completions of
   * archived habits must remain queryable for analytics and journaling.
   */
  public async deleteHabit(id: string, userId: string): Promise<Habit> {
    const habit = await this.findOne(id, userId);
    if (habit.lifecycleStatus === 'BURIED') throw new ConflictException('Buried habits must be restored before changing them');

    const [completionCount, linkCount, burialCount, eventCount] = await Promise.all([
      this.databaseSvc.completion.count({ where: { habitId: id } }),
      this.databaseSvc.identityHabit.count({ where: { habitId: id } }),
      this.databaseSvc.habitBurial.count({ where: { habitId: id } }),
      this.databaseSvc.habitLifecycleEvent.count({ where: { habitId: id } }),
    ]);

    if (completionCount > 0 || linkCount > 0 || burialCount > 0 || eventCount > 0) {
      return this.databaseSvc.$transaction(async (tx) => {
        const archived = await tx.habit.update({
          where: { id },
          data: { isArchived: true, lifecycleStatus: 'ARCHIVED', version: { increment: 1 } },
        });
        await tx.reminder.updateMany({
          where: { habitId: id, enabled: true },
          data: { enabled: false },
        });
        return archived;
      }, INTERACTIVE_TX_OPTIONS);
    }

    return this.databaseSvc.habit.delete({ where: { id } });
  }

  /**
   * Expires past-endDate habits. Historical behavior hard-DELETED these,
   * destroying completions and identity evidence; habits are now archived
   * instead. History stays intact and restorable. Enabled reminders are
   * disabled so archived habits stop generating reminders.
   */
  public async cleanupExpiredHabits(): Promise<number> {
    const now = new Date();

    const expired = await this.databaseSvc.habit.findMany({
      where: {
        endDate: { not: null, lt: now },
        isArchived: false,
      },
      select: { id: true },
    });
    if (expired.length === 0) return 0;

    const ids = expired.map((h) => h.id);
    return this.databaseSvc.$transaction(async (tx) => {
      const result = await tx.habit.updateMany({
        where: { id: { in: ids } },
        data: { isArchived: true, lifecycleStatus: 'EXPIRED', version: { increment: 1 } },
      });
      await tx.reminder.updateMany({
        where: { habitId: { in: ids }, enabled: true },
        data: { enabled: false },
      });
      return result.count;
    }, INTERACTIVE_TX_OPTIONS);
  }

  /**
   * Validates a proposed stack edge. `forHabitId` is omitted on creation.
   * Ownership + self-reference + archived-target + full chain cycles are
   * enforced here — the database FK alone cannot detect logical loops.
   */
  private async assertStackTarget(
    db: Tx | DatabaseService,
    userId: string,
    stackAfterHabitId: string,
    forHabitId?: string,
  ): Promise<void> {
    if (forHabitId && stackAfterHabitId === forHabitId) {
      throw new BadRequestException('A habit cannot be stacked after itself');
    }

    const target = await db.habit.findFirst({
      where: { id: stackAfterHabitId, userId },
      select: { id: true, isArchived: true },
    });
    if (!target) {
      throw new NotFoundException(
        `Stack target habit with ID ${stackAfterHabitId} not found`,
      );
    }
    if (target.isArchived) {
      throw new ConflictException(
        'Habits cannot be stacked after an archived habit',
      );
    }

    const edges = await db.habit.findMany({
      where: { userId, stackAfterHabitId: { not: null } },
      select: { id: true, stackAfterHabitId: true },
    });

    const stackEdges: StackEdge[] = edges.map((edge) => ({
      habitId: edge.id,
      stackAfterHabitId: edge.stackAfterHabitId,
    }));

    if (
      wouldCreateStackCycle(
        stackEdges,
        forHabitId ?? stackAfterHabitId,
        stackAfterHabitId,
      )
    ) {
      throw new ConflictException(
        'This stack would create a circular habit chain',
      );
    }
  }

  private assertValidCompletionKind(habit: Habit, kind: CompletionKind) {
    if (kind === 'MINIMUM' && !habit.minimumBehavior) {
      throw new BadRequestException(
        'This habit has no minimum version configured',
      );
    }
    if (kind === 'EMERGENCY' && !habit.emergencyMinimum) {
      throw new BadRequestException(
        'This habit has no emergency version configured',
      );
    }
  }

  private async linkIdentities(
    tx: Tx,
    userId: string,
    habitId: string,
    identityIds: string[],
  ) {
    const owned = await tx.identity.findMany({
      where: { id: { in: identityIds }, userId },
      select: { id: true },
    });
    if (owned.length !== new Set(identityIds).size) {
      throw new NotFoundException('One or more identities were not found');
    }
    await tx.identityHabit.createMany({
      data: [...new Set(identityIds)].map((identityId) => ({
        identityId,
        habitId,
      })),
      skipDuplicates: true,
    });
  }

  /** Reconciles the identity links to exactly match the provided list. */
  private async syncIdentityLinks(
    tx: Tx,
    userId: string,
    habitId: string,
    identityIds: string[],
  ) {
    const uniqueIds = [...new Set(identityIds)];
    const owned = await tx.identity.findMany({
      where: { id: { in: uniqueIds }, userId },
      select: { id: true },
    });
    if (owned.length !== uniqueIds.length) {
      throw new NotFoundException('One or more identities were not found');
    }

    const existing = await tx.identityHabit.findMany({
      where: { habitId },
      select: { id: true, identityId: true },
    });

    const keep = new Set(uniqueIds);
    const toRemove = existing.filter((l) => !keep.has(l.identityId));
    const toAdd = uniqueIds.filter(
      (id) => !existing.some((l) => l.identityId === id),
    );

    if (toRemove.length > 0) {
      await tx.identityHabit.deleteMany({
        where: { id: { in: toRemove.map((l) => l.id) } },
      });
    }
    if (toAdd.length > 0) {
      await tx.identityHabit.createMany({
        data: toAdd.map((identityId) => ({ identityId, habitId })),
        skipDuplicates: true,
      });
    }
  }

  private parseHabitDates<T extends Record<string, unknown>>(habitData: T) {
    const toDate = (value: unknown): Date | undefined => {
      if (value === undefined || value === null || value instanceof Date) {
        return value instanceof Date ? value : undefined;
      }
      return new Date(value as string);
    };
    return {
      ...habitData,
      startDate: toDate(habitData.startDate),
      endDate: toDate(habitData.endDate),
    };
  }

  private eventForKind(
    kind: CompletionKind,
  ): 'habit.completed' | 'habit.minimumCompleted' | 'habit.emergencyCompleted' {
    switch (kind) {
      case 'MINIMUM':
        return 'habit.minimumCompleted';
      case 'EMERGENCY':
        return 'habit.emergencyCompleted';
      default:
        return 'habit.completed';
    }
  }

  /**
   * Creates/updates/removes a completion for one calendar day.
   *
   * Guarantees:
   * - Idempotent & race-safe: the (habitId, date) unique constraint plus
   *   P2002 recovery ensure a single completion row per day.
   * - Side effects (XP, coin ledger + cached balance) run INSIDE the same
   *   transaction as the state transition and only on actual transitions
   *   (e.g. false -> true). Duplicate requests never double-award because
   *   the reward ledger enforces uniqueness per completion.
   * - Toggle-off reverses previously granted XP and coins via REVERSAL
   *   ledger entries.
   */
  public async toggleCompletion(
    habitId: string,
    userId: string,
    date: string,
    value?: number,
    kindInput?: string,
  ): Promise<CompletionResult> {
    // A local day can be one date ahead of UTC (UTC+14). Reject anything
    // beyond that bound while preserving existing backdated check-ins.
    this.assertCompletionDayKey(date);
    const habit = await this.findOne(habitId, userId);
    const kind = (kindInput ?? 'FULL') as CompletionKind;
    this.assertValidCompletionKind(habit, kind);

    const existing = await this.databaseSvc.completion.findUnique({
      where: {
        habitId_date: { habitId, date },
      },
    });

    // Archived habits accept reversal of existing entries but no NEW wins.
    if (!existing && (habit.isArchived || (habit.lifecycleStatus && habit.lifecycleStatus !== 'ACTIVE'))) {
      throw new ConflictException(
        'Archived habits cannot receive new completions. Restore the habit first.',
      );
    }

    const result = await this.databaseSvc.$transaction<
      CompletionResult | null
    >(async (tx) => {
      // FULL keeps historical semantics; reduced kinds are successes by
      // definition regardless of the logged quantity.
      const completionValue = value ?? habit.goal;
      const isCompleted = kind === 'FULL' ? completionValue >= habit.goal : true;

      // Snapshot of a previously AWARDED completion for this day, if any.
      const priorAward =
        existing && existing.status
          ? { id: existing.id, kind: existing.kind }
          : null;
      const kindChanged =
        priorAward !== null && isCompleted && priorAward.kind !== kind;
      const transitionToCompleted = isCompleted && priorAward === null;

      let coinsDelta = 0;

      // ---- Removal path (legacy toggle off) ----
      if (existing && value === undefined && kindInput === undefined) {
        await tx.completion.delete({ where: { id: existing.id } });
        let coinsDelta = 0;
        let reversedKind: CompletionKind | undefined;
        if (priorAward) {
          await this.profileSvc.addExperienceTx(tx, userId, -XP_PER_COMPLETION);
          const reversed = await this.rewardEngine.reverseCompletionRewardsTx(
            tx,
            {
              userId,
              habitId,
              completionId: priorAward.id,
              priorKind: priorAward.kind,
            },
          );
          coinsDelta -= reversed;
          reversedKind = priorAward.kind;
        }
        // The virtual reward fund allocation dies with the completion.
        await tx.habitRewardAllocation.deleteMany({
          where: { habitId, completionId: existing.id },
        });
        return {
          ...existing,
          status: false,
          rewards:
            reversedKind !== undefined
              ? { coinsAwarded: coinsDelta, kind: reversedKind }
              : undefined,
        };
      }

      // ---- Create / update path ----
      let completion: Completion;
      if (existing) {
        completion = await tx.completion.update({
          where: { id: existing.id },
          data: {
            value: completionValue,
            status: isCompleted,
            kind,
          },
        });
      } else {
        try {
          completion = await tx.completion.create({
            data: {
              habitId,
              date,
              status: isCompleted,
              value: completionValue,
              kind,
            },
          });
        } catch (error: unknown) {
          // Lost a race against a concurrent identical toggle: adopt that row
          // instead of double-awarding its side effects.
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            const raced = await tx.completion.findUnique({
              where: { habitId_date: { habitId, date } },
            });
            if (!raced) {
              // The raced transaction deleted the row again (on/off race).
              throw new ConflictException(
                'Completion state changed concurrently, please retry',
              );
            }
            if (raced.status) {
              return {
                ...raced,
                rewards: { coinsAwarded: 0, kind: raced.kind },
              };
            }
            completion = raced;
          } else {
            throw error;
          }
        }
      }

      // ---- Award transitions (only on actual state changes) ----
      let breakdown: RewardBreakdown | undefined;
      if (!isCompleted) {
        if (priorAward) {
          // Downgrade from completed back to partial progress.
          await this.profileSvc.addExperienceTx(tx, userId, -XP_PER_COMPLETION);
          coinsDelta -= await this.rewardEngine.reverseCompletionRewardsTx(tx, {
            userId,
            habitId,
            completionId: priorAward.id,
            priorKind: priorAward.kind,
          });
        }
      } else {
        if (priorAward && kindChanged) {
          // Same-day re-log with a different version: swap the coin grant so
          // totals reflect the latest truth. XP for the day is kept. Streak
          // cycles stay intact, so only the base grant swaps.
          coinsDelta -= await this.rewardEngine.reverseCompletionRewardsTx(tx, {
            userId,
            habitId,
            completionId: priorAward.id,
            priorKind: priorAward.kind,
          });
        }
        if (transitionToCompleted) {
          await this.profileSvc.addExperienceTx(tx, userId, XP_PER_COMPLETION);
        }
        if (transitionToCompleted || kindChanged) {
          breakdown = await this.rewardEngine.awardForCompletionTx(tx, {
            userId,
            habitId,
            completionId: completion.id,
            kind,
            date,
            habitTitle: habit.title,
            rules: {
              fullCoins: habit.fullCoins,
              minimumCoins: habit.minimumCoins,
              emergencyCoins: habit.emergencyCoins,
              streakBonusEnabled: habit.streakBonusEnabled,
              identityBonusEnabled: habit.identityBonusEnabled,
            },
          });
          coinsDelta += breakdown.total;

          if (transitionToCompleted) {
            // MAKE IT ATTRACTIVE — AUTHORITATIVE RULE: a temptation bundle is
            // the reward for the complete intended behavior, so ONLY a FULL
            // completion unlocks it. MINIMUM/EMERGENCY preserve streak,
            // identity evidence and coins, but never release the temptation
            // reward. Unlock is one-way and idempotent (LOCKED -> UNLOCKED
            // via updateMany); bundles are never re-locked by toggle-offs.
            if (kind === 'FULL') {
              await tx.temptationBundle.updateMany({
                where: { habitId, status: 'LOCKED' },
                data: { status: 'UNLOCKED', unlockedAt: new Date() },
              });
            }
            // Virtual Reward Fund: naira allocation on FULL completions only.
            if (kind === 'FULL' && habit.rewardFundAmount) {
              try {
                await tx.habitRewardAllocation.create({
                  data: {
                    userId,
                    habitId,
                    completionId: completion.id,
                    amount: habit.rewardFundAmount,
                  },
                });
              } catch (err) {
                if (
                  (err as Prisma.PrismaClientKnownRequestError)?.code !== 'P2002'
                ) {
                  throw err;
                }
              }
            }
          }
        }
      }

      const rewards: CompletionResult['rewards'] = {
        coinsAwarded: coinsDelta,
        kind,
      };
      if (breakdown) {
        rewards.breakdown = breakdown.lines;
        rewards.streak = breakdown.streak;
        rewards.newStreakMilestones = breakdown.newStreakMilestones;
        rewards.newIdentityMilestones = breakdown.newIdentityMilestones;
      }
      return {
        ...completion,
        rewards,
      };
    }, INTERACTIVE_TX_OPTIONS);

    if (!result) {
      throw new BadRequestException('Completion could not be processed');
    }

    const finalStatus =
      result.status ?? false;

    // Post-commit side effects (best-effort, non-critical). Badge rules are
    // idempotent and evidence is derived, so a failure here cannot corrupt
    // balances or history.
    if (finalStatus) {
      await this.awardsSvc.checkAndAwardBadges(userId);
      this.domainEvents.emit(this.eventForKind(result.kind), {
        userId,
        habitId,
        completionId: result.id,
        date,
        kind: result.kind,
      });
      // Milestone notifications are optional side effects: safe on events.
      for (const milestone of result.rewards?.newStreakMilestones ?? []) {
        this.domainEvents.emit('habit.streakMilestoneReached', {
          userId,
          habitId,
          streak: result.rewards?.streak ?? 0,
          milestone,
          date,
        });
      }
      for (const identityMilestone of result.rewards?.newIdentityMilestones ??
        []) {
        this.domainEvents.emit('identity.milestoneReached', {
          userId,
          identityId: identityMilestone.identityId,
          threshold: identityMilestone.threshold,
          date,
        });
      }
    } else if (existing?.status) {
      this.domainEvents.emit('habit.uncompleted', {
        userId,
        habitId,
        completionId: existing.id,
        date,
        previousKind: existing.kind,
      });
    }

    // Identity evidence attached for completed actions on linked identities.
    if (finalStatus) {
      const links = await this.databaseSvc.identityHabit.findMany({
        where: { habitId },
        include: {
          identity: { select: { id: true, title: true, status: true } },
        },
      });
      const activeLinks = links.filter((l) => l.identity.status === 'ACTIVE');
      if (activeLinks.length > 0) {
        result.identityEvidence = {
          identities: activeLinks.map((l) => ({
            id: l.identity.id,
            title: l.identity.title,
            evidencePoints: EVIDENCE_POINTS[result.kind],
          })),
        };
      }
    }

    return result;
  }

  public async setCompletion(habitId: string, userId: string, date: string, desired: SetCompletionDto) {
    this.assertCompletionDayKey(date);
    const habit = await this.findOne(habitId, userId);
    const existing = await this.databaseSvc.completion.findUnique({ where: { habitId_date: { habitId, date } } });
    if (desired.status) {
      const value = desired.value ?? habit.goal;
      const kind = desired.kind ?? 'FULL';
      if (existing && existing.status && existing.value === value && existing.kind === kind) return existing;
      return this.toggleCompletion(habitId, userId, date, desired.value ?? habit.goal, desired.kind ?? 'FULL');
    }
    if (!existing) return { habitId, date, status: false };
    try {
      return await this.toggleCompletion(habitId, userId, date);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return { habitId, date, status: false };
      }
      throw error;
    }
  }

  private assertCompletionDayKey(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('Invalid completion date');
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new BadRequestException('Invalid completion date');
    }
    const latestLocalDay = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    if (date > latestLocalDay) throw new BadRequestException('Completion date cannot be in the future');
  }
}
