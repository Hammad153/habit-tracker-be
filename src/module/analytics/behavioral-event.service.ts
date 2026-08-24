import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BehavioralEventType, Prisma } from '@prisma/client';
import { DatabaseService } from '../../core/database/database.service';

/**
 * Phase 4.1 — behavioral intent/outcome event ledger.
 *
 * APPEND-ONLY observation layer. No decision logic lives here; every record
 * call validates a server-authoritative correlation object (delivery,
 * proposal, prior generated intervention) before writing. Idempotency is
 * enforced by the database unique (userId, fingerprint, type) — concurrent
 * duplicates collapse to one logical event.
 */

const INTERVENTION_TYPES: ReadonlySet<BehavioralEventType> = new Set([
  'INTERVENTION_GENERATED',
  'INTERVENTION_VIEWED',
  'INTERVENTION_DISMISSED',
  'INTERVENTION_ACTION_STARTED',
  'INTERVENTION_ACTION_COMPLETED',
] as BehavioralEventType[]);

export interface RecordEventInput {
  type: BehavioralEventType;
  fingerprint: string;
  habitId?: string | null;
  proposalId?: string | null;
  notificationDeliveryId?: string | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class BehavioralEventService {
  constructor(private readonly databaseSvc: DatabaseService) {}

  /** Internal/server-authorized recording. Idempotent by unique constraint. */
  public async record(userId: string, input: RecordEventInput): Promise<{ id: string; deduplicated: boolean }> {
    this.assertFingerprint(input.fingerprint);
    try {
      const row = await this.databaseSvc.behavioralEvent.create({
        data: {
          userId,
          type: input.type,
          fingerprint: input.fingerprint,
          habitId: input.habitId ?? null,
          proposalId: input.proposalId ?? null,
          notificationDeliveryId: input.notificationDeliveryId ?? null,
          metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      return { id: row.id, deduplicated: false };
    } catch (err) {
      // Unique violation on (userId, fingerprint, type) → logical duplicate.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const existing = await this.databaseSvc.behavioralEvent.findFirstOrThrow({
          where: { userId, fingerprint: input.fingerprint, type: input.type },
          select: { id: true },
        });
        return { id: existing.id, deduplicated: true };
      }
      throw err;
    }
  }

  /** Server-side GENERATED emission for interventions (Phase 3.2 flow). */
  public async recordInterventionGenerated(
    userId: string,
    args: { fingerprint: string; habitId: string },
  ): Promise<void> {
    await this.record(userId, {
      type: 'INTERVENTION_GENERATED',
      fingerprint: args.fingerprint,
      habitId: args.habitId,
      metadata: { source: 'intervention-engine' },
    });
  }

  /** Client-observable intervention interactions. */
  public async recordInterventionInteraction(
    userId: string,
    fingerprint: string,
    type: Extract<
      BehavioralEventType,
      | 'INTERVENTION_VIEWED'
      | 'INTERVENTION_DISMISSED'
      | 'INTERVENTION_ACTION_STARTED'
      | 'INTERVENTION_ACTION_COMPLETED'
    >,
  ): Promise<{ id: string; deduplicated: boolean }> {
    this.assertFingerprint(fingerprint);
    if (!INTERVENTION_TYPES.has(type)) {
      throw new BadRequestException('invalid intervention event type');
    }
    // Impossible-transition guard: the intervention must have been GENERATED
    // by the server before any interaction can be observed.
    const generated = await this.databaseSvc.behavioralEvent.findFirst({
      where: { userId, fingerprint, type: 'INTERVENTION_GENERATED' },
      select: { id: true, habitId: true },
    });
    if (!generated) {
      throw new NotFoundException('No generated intervention for fingerprint');
    }
    if (type === 'INTERVENTION_ACTION_COMPLETED') {
      // Server-authoritative action verification (spec §7): a completion
      // event is only recorded when the habit was ACTUALLY completed today.
      const habitId = generated.habitId;
      if (!habitId) {
        throw new BadRequestException('intervention has no habit correlation');
      }
      const todayKey = new Date().toISOString().slice(0, 10);
      // Ownership flows through the habit relation (Completion has no direct
      // userId column): a verified TODAY completion for THIS user's habit.
      const completed = await this.databaseSvc.completion.findFirst({
        where: {
          habitId,
          date: todayKey,
          status: true,
          habit: { userId },
        },
        select: { id: true },
      });
      if (!completed) {
        throw new BadRequestException(
          'action-completed requires a verified habit completion',
        );
      }
    }
    return this.record(userId, {
      type,
      fingerprint,
      habitId: generated.habitId,
    });
  }

  /** Candidate/delivery/open funnel backed by NotificationDelivery truth. */
  public async recordCandidateGenerated(
    userId: string,
    args: { fingerprint: string },
  ): Promise<void> {
    await this.record(userId, {
      type: 'NOTIFICATION_CANDIDATE_GENERATED',
      fingerprint: args.fingerprint,
      metadata: { source: 'notification-candidates' },
    });
  }

  public async recordDelivered(
    userId: string,
    deliveryId: string,
    fingerprint: string,
  ): Promise<void> {
    await this.ensureDeliveryOwnership(userId, deliveryId);
    await this.record(userId, {
      type: 'NOTIFICATION_DELIVERED',
      fingerprint,
      notificationDeliveryId: deliveryId,
    });
  }

  public async recordNotificationInteraction(
    userId: string,
    deliveryId: string,
    type: Extract<
      BehavioralEventType,
      | 'NOTIFICATION_OPENED'
      | 'NOTIFICATION_DISMISSED'
      | 'NOTIFICATION_ACTION_STARTED'
      | 'NOTIFICATION_ACTION_COMPLETED'
    >,
  ): Promise<void> {
    const delivery = await this.ensureDeliveryOwnership(userId, deliveryId);

    // Funnel gates — EVERY interaction requires DELIVERED first; actions
    // additionally require their predecessor step (spec §10).
    const deliveredEvent = await this.databaseSvc.behavioralEvent.findFirst({
      where: {
        userId,
        notificationDeliveryId: deliveryId,
        type: 'NOTIFICATION_DELIVERED',
      },
      select: { id: true, fingerprint: true },
    });
    if (!deliveredEvent) {
      throw new BadRequestException('notification not yet marked delivered');
    }

    const predecessorType: BehavioralEventType =
      type === 'NOTIFICATION_OPENED' || type === 'NOTIFICATION_DISMISSED'
        ? 'NOTIFICATION_DELIVERED' // already proven above
        : type === 'NOTIFICATION_ACTION_STARTED'
          ? 'NOTIFICATION_OPENED'
          : 'NOTIFICATION_ACTION_STARTED';

    if (predecessorType !== 'NOTIFICATION_DELIVERED') {
      const predecessor = await this.databaseSvc.behavioralEvent.findFirst({
        where: {
          userId,
          notificationDeliveryId: deliveryId,
          type: predecessorType,
        },
        select: { id: true },
      });
      if (!predecessor) {
        throw new BadRequestException(
          `notification has not reached ${predecessorType} yet`,
        );
      }
    }
    await this.record(userId, {
      type,
      fingerprint: `${delivery.fingerprint}:${type.split('_')[2]?.toLowerCase() ?? 'acted'}`,
      notificationDeliveryId: deliveryId,
    });
  }

  /** Adaptive proposal lifecycle events (status machine stays authoritative). */
  public async recordProposalEvent(
    userId: string,
    proposalId: string,
    type: Extract<
      BehavioralEventType,
      | 'ADAPTIVE_PROPOSAL_GENERATED'
      | 'ADAPTIVE_PROPOSAL_VIEWED'
      | 'ADAPTIVE_PROPOSAL_ACCEPTED'
      | 'ADAPTIVE_PROPOSAL_REJECTED'
    >,
  ): Promise<void> {
    const proposal = await this.databaseSvc.habitAdjustmentProposal.findFirst({
      where: { id: proposalId, userId },
      select: { id: true, habitId: true, status: true },
    });
    if (!proposal) throw new NotFoundException('Proposal not found');

    if (type === 'ADAPTIVE_PROPOSAL_ACCEPTED' && proposal.status !== 'ACCEPTED') {
      throw new BadRequestException('proposal is not in ACCEPTED state');
    }
    if (type === 'ADAPTIVE_PROPOSAL_REJECTED' && proposal.status !== 'REJECTED') {
      throw new BadRequestException('proposal is not in REJECTED state');
    }
    // ACCEPTED after REJECTED (or vice versa) is an impossible transition —
    // the unique ledger key would allow it, so validate explicitly.
    if (type === 'ADAPTIVE_PROPOSAL_ACCEPTED') {
      const rejected = await this.databaseSvc.behavioralEvent.findFirst({
        where: {
          userId,
          proposalId,
          type: 'ADAPTIVE_PROPOSAL_REJECTED',
        },
        select: { id: true },
      });
      if (rejected) {
        throw new BadRequestException('proposal already rejected — impossible transition');
      }
    }
    if (type === 'ADAPTIVE_PROPOSAL_REJECTED') {
      const acceptedEvt = await this.databaseSvc.behavioralEvent.findFirst({
        where: {
          userId,
          proposalId,
          type: 'ADAPTIVE_PROPOSAL_ACCEPTED',
        },
        select: { id: true },
      });
      if (acceptedEvt) {
        throw new BadRequestException('proposal already accepted — impossible transition');
      }
    }

    await this.record(userId, {
      type,
      fingerprint: `proposal:${proposalId}:${type.split('_').pop()?.toLowerCase()}`,
      habitId: proposal.habitId,
      proposalId,
    });
  }

  public async recordWeeklyReviewViewed(userId: string, weekStart: string): Promise<void> {
    this.assertFingerprint(`weekly-review:${weekStart}`);
    await this.record(userId, {
      type: 'WEEKLY_REVIEW_VIEWED',
      fingerprint: `weekly-review:${weekStart}:viewed`,
      metadata: { weekStart },
    });
  }

  public async recordWeeklyReviewRegenerated(userId: string, weekStart: string): Promise<void> {
    await this.record(userId, {
      type: 'WEEKLY_REVIEW_REGENERATED',
      fingerprint: `weekly-review:${weekStart}:regenerated`,
      metadata: { weekStart },
    });
  }

  /** Read-only aggregation helper for admin analytics (correct funnels). */
  public async funnelCounts(userId: string, fromAt: Date, toAt: Date) {
    const groups = await this.databaseSvc.behavioralEvent.groupBy({
      by: ['type'],
      where: { userId, occurredAt: { gte: fromAt, lte: toAt } },
      _count: { _all: true },
    });
    const out: Record<string, number> = {};
    for (const g of groups) out[g.type] = g._count._all;
    return out;
  }

  // -------------------------------------------------------------------------

  private assertFingerprint(fp: string): void {
    if (!fp || fp.length < 6 || fp.length > 160 || /\s/.test(fp)) {
      throw new BadRequestException('malformed fingerprint');
    }
  }

  private async ensureDeliveryOwnership(userId: string, deliveryId: string) {
    const delivery = await this.databaseSvc.notificationDelivery.findFirst({
      where: { id: deliveryId, userId },
      select: { id: true, fingerprint: true },
    });
    if (!delivery) {
      // Foreign OR nonexistent deliveries are indistinguishable (IDOR-safe).
      throw new ForbiddenException('Notification delivery not found');
    }
    return delivery;
  }
}
