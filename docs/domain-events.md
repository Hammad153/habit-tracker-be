# Domain Events — Contract & Operational Notes

## Catalog

| Event                    | Emitted when                                                                 | Payload |
|--------------------------|------------------------------------------------------------------------------|---------|
| `habit.completed`        | A completion transitions from not-completed to completed with kind `FULL`.    | `{ userId, habitId, completionId, date, kind }` |
| `habit.minimumCompleted` | Same transition with kind `MINIMUM`.                                          | same |
| `habit.emergencyCompleted` | Same transition with kind `EMERGENCY`.                                      | same |
| `habit.uncompleted`      | A completed day is toggled off or its completion row deleted.                 | `{ userId, habitId, completionId, date, previousKind }` |

Emission points live exclusively in `HabitService.toggleCompletion`
(`src/module/habit/habit.service.ts`). The daily-plan task path mutates the
same `Completion` rows through `DailyPlanService.syncCompletion`, which does
not emit events; if you add consumers that must observe daily-plan-driven
completions, route them through one shared emitter first.

## Guarantees

- **At-most-once per state transition.** Events are emitted only after the
  transaction that changed state succeeds, and only on real transitions
  (no event for idempotent re-toggles or same-kind re-logs).
- **Best-effort delivery.** Handlers run in-process via `setImmediate`.
  Handler failures are logged, never retried, and never propagated to the
  request.
- **Ordering.** Per-process FIFO by emission time; no cross-instance ordering.

## Serverless safety

Events do **not** survive process boundaries. On serverless platforms
(individual Lambda invocations, short-lived containers):

1. In-process handlers still run within the same invocation that emitted the
   event — safe for side effects that must complete before the response is
   considered final (e.g. badge checks).
2. Any consumer needing durability across invocations (emails, analytics,
   webhooks) must be backed by persistent storage (DB outbox table + worker,
   or a queue). Do NOT rely on `DomainEventService` listeners for work that
   must survive crashes or run on other instances.

Current consumers: badge checks (`AwardsService`) are invoked directly after
transactions rather than via events precisely because of this limitation.

## Adding a consumer

```ts
this.domainEvents.on('habit.completed', async (payload) => {
  // keep handlers fast; errors are swallowed + logged
});
```

Rules: handlers must be idempotent (redelivery on retry is possible at the
application level), must not mutate completion rows (risk of feedback loops),
and must not throw.
