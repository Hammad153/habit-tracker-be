import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CompletionKind, Completion, Prisma, Habit } from '@prisma/client';
import { DatabaseService } from '../../core/database/database.service';
import { ProfileService } from '../profile/profile.service';
import { AwardsService } from '../awards/awards.service';
import { RewardsService } from '../rewards/rewards.service';
import { DomainEventService } from '../../core/events/domain-event.service';
import { XP_PER_COMPLETION } from '../../core/utils/progression.utils';
import { EVIDENCE_POINTS } from '../../core/utils/evidence.utils';
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
    private rewardsSvc: RewardsService,
    private domainEvents: DomainEventService,
  ) {}

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

    return this.databaseSvc.$transaction(async (tx) => {
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
    });
  }

  public async updateHabit(
    id: string,
    userId: string,
    data: any,
  ): Promise<Habit> {
    await this.findOne(id, userId); // enforces ownership
    const habitData = { ...(data ?? {}) } as Record<string, unknown>;
    delete habitData.userId;

    return this.databaseSvc.$transaction(async (tx) => {
      const { identityIds, ...rest } = habitData;

      const processedData = this.parseHabitDates(
        rest as Record<string, unknown>,
      ) as Prisma.HabitUncheckedUpdateInput & {
        stackAfterHabitId?: string | null;
      };

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
        where: { id },
        data: processedData,
      });
    });
  }

  /**
   * Soft-deletes by archiving when the habit carries history or identity
   * evidence; brand-new unused habits are removed outright. Completions of
   * archived habits must remain queryable for analytics and journaling.
   */
  public async deleteHabit(id: string, userId: string): Promise<Habit> {
    await this.findOne(id, userId);

    const [completionCount, linkCount] = await Promise.all([
      this.databaseSvc.completion.count({ where: { habitId: id } }),
      this.databaseSvc.identityHabit.count({ where: { habitId: id } }),
    ]);

    if (completionCount > 0 || linkCount > 0) {
      const [archived] = await Promise.all([
        this.databaseSvc.habit.update({
          where: { id },
          data: { isArchived: true },
        }),
        this.databaseSvc.reminder.updateMany({
          where: { habitId: id, enabled: true },
          data: { enabled: false },
        }),
      ]);
      return archived;
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
    const [result] = await Promise.all([
      this.databaseSvc.habit.updateMany({
        where: { id: { in: ids } },
        data: { isArchived: true },
      }),
      this.databaseSvc.reminder.updateMany({
        where: { habitId: { in: ids }, enabled: true },
        data: { enabled: false },
      }),
    ]);

    return result.count;
  }

  /**
   * Validates a proposed stack edge. `forHabitId` is omitted on creation.
   * Ownership + self-reference + full chain cycles are enforced here —
   * the database FK alone cannot detect logical loops.
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
      select: { id: true },
    });
    if (!target) {
      throw new NotFoundException(
        `Stack target habit with ID ${stackAfterHabitId} not found`,
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
    const habit = await this.findOne(habitId, userId);
    const kind = (kindInput ?? 'FULL') as CompletionKind;
    this.assertValidCompletionKind(habit, kind);

    const existing = await this.databaseSvc.completion.findUnique({
      where: {
        habitId_date: { habitId, date },
      },
    });

    // Archived habits accept reversal of existing entries but no NEW wins.
    if (!existing && habit.isArchived) {
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
        let reversedKind: CompletionKind | undefined;
        if (priorAward) {
          await this.profileSvc.addExperienceTx(tx, userId, -XP_PER_COMPLETION);
          const reversed = await this.rewardsSvc.reverseCompletionAward(tx, {
            userId,
            completionId: priorAward.id,
            kind: priorAward.kind,
            habitTitle: habit.title,
          });
          coinsDelta -= reversed;
          reversedKind = priorAward.kind;
        }
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
            const raced = await tx.completion.findUniqueOrThrow({
              where: { habitId_date: { habitId, date } },
            });
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
      if (!isCompleted) {
        if (priorAward) {
          // Downgrade from completed back to partial progress.
          await this.profileSvc.addExperienceTx(tx, userId, -XP_PER_COMPLETION);
          coinsDelta -= await this.rewardsSvc.reverseCompletionAward(tx, {
            userId,
            completionId: priorAward.id,
            kind: priorAward.kind,
            habitTitle: habit.title,
          });
        }
      } else {
        if (priorAward && kindChanged) {
          // Same-day re-log with a different version: swap the coin grant so
          // totals reflect the latest truth. XP for the day is kept.
          coinsDelta -= await this.rewardsSvc.reverseCompletionAward(tx, {
            userId,
            completionId: priorAward.id,
            kind: priorAward.kind,
            habitTitle: habit.title,
          });
        }
        if (transitionToCompleted) {
          await this.profileSvc.addExperienceTx(tx, userId, XP_PER_COMPLETION);
        }
        if (transitionToCompleted || kindChanged) {
          coinsDelta += await this.rewardsSvc.awardForCompletion(tx, {
            userId,
            completionId: completion.id,
            kind,
            habitTitle: habit.title,
          });
        }
      }

      return {
        ...completion,
        rewards: { coinsAwarded: coinsDelta, kind },
      };
    });

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
}
