import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'events';

/**
 * Domain events emitted by the habit system.
 *
 * Every event represents a SUCCESSFUL state transition: it is published only
 * after the database transaction that changed the state has committed.
 */
export interface HabitCompletedEvent {
  userId: string;
  habitId: string;
  completionId: string;
  date: string;
  kind: 'FULL' | 'MINIMUM' | 'EMERGENCY';
}

export interface HabitUncompletedEvent {
  userId: string;
  habitId: string;
  completionId: string;
  date: string;
  previousKind: 'FULL' | 'MINIMUM' | 'EMERGENCY';
}

export interface HabitStreakMilestoneEvent {
  userId: string;
  habitId: string;
  streak: number;
  milestone: number;
  date: string;
}

export interface IdentityMilestoneEvent {
  userId: string;
  identityId: string;
  threshold: number;
  date: string;
}

export type DomainEventMap = {
  'habit.completed': HabitCompletedEvent;
  'habit.minimumCompleted': HabitCompletedEvent;
  'habit.emergencyCompleted': HabitCompletedEvent;
  'habit.uncompleted': HabitUncompletedEvent;
  'habit.streakMilestoneReached': HabitStreakMilestoneEvent;
  'identity.milestoneReached': IdentityMilestoneEvent;
};

export type DomainEventName = keyof DomainEventMap;

type Handler<T> = (payload: T) => void | Promise<void>;

/**
 * Lightweight in-process typed event dispatcher.
 *
 * LIMITATIONS (by design for Phase 1):
 * - Synchronous and in-process. Handlers run inline within the request that
 *   emitted the event; a crashing handler must never break the request, so
 *   handler errors are caught and logged.
 * - Events do NOT survive process boundaries (serverless invocations). Any
 *   future consumer that requires durability must move to persistent jobs.
 */
@Injectable()
export class DomainEventService implements OnModuleDestroy {
  private readonly logger = new Logger(DomainEventService.name);
  private readonly emitter = new EventEmitter();

  constructor() {
    // A single slow/crashing subscriber must not block others arbitrarily.
    this.emitter.setMaxListeners(50);
  }

  emit<K extends DomainEventName>(event: K, payload: DomainEventMap[K]): void {
    setImmediate(() => {
      for (const handler of this.emitter.listeners(event) as Array<
        Handler<DomainEventMap[K]>
      >) {
        try {
          const result = handler(payload) as unknown;
          if (result instanceof Promise) {
            result.catch((err: Error) =>
              this.logger.error(
                `Async handler failed for ${event}: ${err?.message}`,
              ),
            );
          }
        } catch (err) {
          this.logger.error(
            `Handler failed for ${event}: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      }
    });
  }

  on<K extends DomainEventName>(
    event: K,
    handler: Handler<DomainEventMap[K]>,
  ): void {
    this.emitter.on(event, (...args: unknown[]) => {
      void (handler as (...handlerArgs: unknown[]) => unknown)(...args);
    });
  }

  onModuleDestroy() {
    this.emitter.removeAllListeners();
  }
}
