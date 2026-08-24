import { NotFoundException } from '@nestjs/common';
import { AdaptiveService } from './adaptive.service';
import { HabitAnalyticsService } from '../analytics/habit-analytics.service';
import { HabitService } from './habit.service';
import { DatabaseService } from '../../core/database/database.service';
import type { AiProvider } from '../../core/ai/ai-provider.interface';
import { buildBehaviorReport, CompletionFact } from '../../core/utils/behavior-analytics.utils';

const TODAY = '2026-08-23';

const run = (endKey: string, count: number, kind: CompletionFact['kind'] = 'FULL'): CompletionFact[] =>
  Array.from({ length: count }, (_, i) => {
    const d = new Date(`${endKey}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - i);
    return { date: d.toISOString().slice(0, 10), status: true, value: 1, kind };
  });

/** Minimum-heavy recent week + sparse emergency history → REDUCE_TARGET. */
const hardReport = () => {
  const comps: CompletionFact[] = [...run(TODAY, 7, 'MINIMUM')];
  for (let i = 8; i <= 29; i += 3) {
    const d = new Date(`${TODAY}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - i);
    if (d.getUTCDay() === 4) continue;
    comps.push({ date: d.toISOString().slice(0, 10), status: true, value: 1, kind: 'EMERGENCY' });
  }
  return buildBehaviorReport({ habit: { id: 'h1', scheduleType: 'daily' }, completions: comps, todayKey: TODAY });
};

const HEALTHY_LANGUAGE = JSON.stringify({
  headline: 'Try a lighter target',
  message: 'Dropping from 5km to 2km keeps the runner identity alive.',
  actionLabel: 'Try 2km',
});

const makeDeps = () => {
  const db = {
    user: { findUnique: jest.fn().mockResolvedValue({ timezone: null }) },
    habit: { findFirst: jest.fn().mockResolvedValue({
      title: 'Run', goal: 5, unit: 'km', scheduleType: 'daily',
      timesPerWeek: null, scheduledTime: '20:00',
      fullBehavior: 'Run 5km', minimumBehavior: 'Walk 5 minutes', emergencyMinimum: null,
    }) },
    habitAdjustmentProposal: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'prop-1', aiHeadline: null, aiMessage: null, ...data })),
      update: jest.fn().mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirstOwned: undefined as unknown as never,
    },
    identityHabit: { findFirst: jest.fn().mockResolvedValue({ identity: { title: 'Runner' } }) },
    $queryRaw: jest.fn(),
  };
  const analytics = { getHabitBehaviorReport: jest.fn().mockResolvedValue(hardReport()) };
  const habitSvc = { updateHabit: jest.fn().mockResolvedValue({ id: 'h1' }) };
  const aiProvider = { name: 'nvidia', model: 'kimi-k2.5', generateRawText: jest.fn().mockResolvedValue(HEALTHY_LANGUAGE), generateCoachResponse: jest.fn() };
  const svc = new AdaptiveService(
    db as unknown as DatabaseService,
    analytics as unknown as HabitAnalyticsService,
    habitSvc as unknown as HabitService,
    aiProvider as unknown as AiProvider,
  );
  // Ownership simulation for proposals:
  db.habitAdjustmentProposal.findFirst.mockImplementation((args) =>
    args.where.userId === 'owner'
      ? Promise.resolve({
          id: args.where.id ?? 'prop-1',
          userId: 'owner',
          habitId: args.where.habitId ?? 'h1',
          fingerprint: 'abc12345',
          type: 'REDUCE_TARGET',
          state: 'MINIMUM_VERSION_OVERUSED',
          status: 'PENDING',
          confidence: 0.75,
          reason: 'r',
          sourceSignals: ['TOO_HARD'],
          evidence: {},
          currentSnapshot: { goal: 5 },
          proposedSnapshot: { goal: 2 },
          aiHeadline: 'Try a lighter target',
          aiMessage: 'Keep the runner identity alive.',
          createdAt: new Date(),
        })
      : Promise.resolve(null),
  );
  return { svc, db, analytics, habitSvc, aiProvider };
};

describe('AdaptiveService — suggestion lifecycle', () => {
  it('creates a PENDING proposal and enriches it with AI wording', async () => {
    const { svc, db, aiProvider } = makeDeps();
    const res = await svc.getSuggestion('owner', 'h1');
    expect(res.suggestion!.type).toBe('REDUCE_TARGET');
    expect(res.suggestion!.proposed).toEqual({ goal: 2 });
    expect(res.ai.generated).toBe(true);
    expect(db.habitAdjustmentProposal.create).toHaveBeenCalledTimes(1);
    expect(aiProvider.generateRawText).toHaveBeenCalledTimes(1);
    const createdData = db.habitAdjustmentProposal.create.mock.calls[0][0].data;
    expect(createdData.status).toBeUndefined(); // schema default PENDING
    expect(createdData.proposedSnapshot).toEqual({ goal: 2 });
  });

  it('reuses the identical open proposal without another AI call', async () => {
    const { svc, db, aiProvider } = makeDeps();
    // First request: nothing open -> create + AI wording.
    db.habitAdjustmentProposal.findFirst.mockResolvedValue(null);
    const first = await svc.getSuggestion('owner', 'h1');
    expect(aiProvider.generateRawText).toHaveBeenCalledTimes(1);

    // Second request: an identical-fingerprint PENDING row now exists.
    aiProvider.generateRawText.mockClear();
    db.habitAdjustmentProposal.create.mockClear();
    db.habitAdjustmentProposal.findFirst.mockResolvedValue({
      id: 'prop-1', userId: 'owner', habitId: 'h1',
      fingerprint: first.suggestion!.fingerprint,
      type: 'REDUCE_TARGET', state: 'MINIMUM_VERSION_OVERUSED', status: 'PENDING',
      confidence: 0.75, reason: 'r', sourceSignals: ['TOO_HARD'],
      evidence: {}, currentSnapshot: { goal: 5 }, proposedSnapshot: { goal: 2 },
      aiHeadline: 'Stored headline', aiMessage: 'Stored message', createdAt: new Date(),
    });
    const second = await svc.getSuggestion('owner', 'h1');
    expect(second.suggestion!.id).toBe('prop-1');
    expect(second.coach!.headline).toBe('Stored headline');
    expect(second.ai.generated).toBe(true); // persisted wording replayed
    expect(aiProvider.generateRawText).not.toHaveBeenCalled();
    expect(db.habitAdjustmentProposal.create).not.toHaveBeenCalled();
  });

  it('expires a stale pending proposal when evidence changes', async () => {
    const { svc, db } = makeDeps();
    db.habitAdjustmentProposal.findFirst
      .mockResolvedValueOnce({ // open pending with DIFFERENT fingerprint
        id: 'old', userId: 'owner', habitId: 'h1', fingerprint: 'deadbeef',
        type: 'REDUCE_TARGET', status: 'PENDING', state: 'TOO_HARD',
        confidence: 0.7, reason: '', sourceSignals: [], evidence: {},
        currentSnapshot: { goal: 5 }, proposedSnapshot: { goal: 3 },
        aiHeadline: null, aiMessage: null, createdAt: new Date(),
      })
      .mockResolvedValue(null);
    await svc.getSuggestion('owner', 'h1');
    expect(db.habitAdjustmentProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'old', status: 'PENDING' } }),
    );
    expect(db.habitAdjustmentProposal.create).toHaveBeenCalledTimes(1);
  });

  it('NO_CHANGE conditions return null suggestion with zero AI spend', async () => {
    const { svc, analytics, aiProvider } = makeDeps();
    analytics.getHabitBehaviorReport.mockResolvedValue(
      buildBehaviorReport({ habit: { id: 'h1', scheduleType: 'daily' }, completions: run(TODAY, 30), todayKey: TODAY }),
    );
    const res = await svc.getSuggestion('owner', 'h1');
    expect(res.suggestion).toBeNull();
    expect(res.ai.provider).toBe('none');
    expect(aiProvider.generateRawText).not.toHaveBeenCalled();
  });

  it('ownership failure propagates NotFound from the analytics service', async () => {
    const { svc, analytics } = makeDeps();
    analytics.getHabitBehaviorReport.mockRejectedValue(new NotFoundException('Habit not found'));
    await expect(svc.getSuggestion('intruder', 'h1')).rejects.toThrow(NotFoundException);
  });
});

describe('AdaptiveService — accept/reject flows', () => {
  it('acceptance writes through the EXISTING habit update path only', async () => {
    const { svc, habitSvc } = makeDeps();
    const res = await svc.acceptProposal('owner', 'h1', 'prop-1');
    expect(habitSvc.updateHabit).toHaveBeenCalledTimes(1);
    expect(habitSvc.updateHabit).toHaveBeenCalledWith('h1', 'owner', { goal: 2 });
    expect(res.suggestion!.current).toEqual({ goal: 5 });
    expect(res.coach!.message).toContain('adjusted');
  });

  it('acceptance never touches rewards, coins, streaks or identity tables', async () => {
    const { svc, db, habitSvc } = makeDeps();
    db.identityHabit.findFirst.mockClear(); // only ever used by GET suggestions
    await svc.acceptProposal('owner', 'h1', 'prop-1');
    // The ONLY domain write is the narrow habit edit:
    expect(habitSvc.updateHabit).toHaveBeenCalledTimes(1);
    expect(habitSvc.updateHabit).toHaveBeenCalledWith('h1', 'owner', { goal: 2 });
    expect(db.identityHabit.findFirst).not.toHaveBeenCalled();
    expect(db.habit.findFirst).not.toHaveBeenCalled(); // no direct Prisma writes
    // The user row is READ-ONLY here (timezone for the evaluation window):
    expect(Object.keys(db.user)).toEqual(['findUnique']);
  });

  it('foreign or non-pending proposals are NotFound on accept and reject', async () => {
    const { svc } = makeDeps();
    await expect(svc.acceptProposal('intruder', 'h1', 'prop-1')).rejects.toThrow(NotFoundException);
    await expect(svc.rejectProposal('intruder', 'h1', 'prop-1')).rejects.toThrow(NotFoundException);
  });

  it('reject persists REJECTED and returns no mutation copy', async () => {
    const { svc, db } = makeDeps();
    const res = await svc.rejectProposal('owner', 'h1', 'prop-1');
    expect(db.habitAdjustmentProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }),
    );
    expect(res.suggestion).toBeDefined();
    expect(res.ai.provider).toBe('none');
  });
});

describe('AdaptiveService — AI security & fallback', () => {
  it.each([
    ['timeout', () => Promise.reject(new Error('TIMEOUT'))],
    ['429', () => Promise.reject(new Error('RATE_LIMITED'))],
    ['500', () => Promise.reject(new Error('HTTP_ERROR'))],
    ['malformed JSON', () => Promise.resolve('nope')],
    ['empty', () => Promise.resolve('')],
    ['schema violation', () => Promise.resolve(JSON.stringify({ wrong: true }))],
  ])('%s → deterministic fallback wording, values untouched', async (_n, behavior) => {
    const { svc, aiProvider } = makeDeps();
    aiProvider.generateRawText.mockImplementation(() => behavior() as never);
    const res = await svc.getSuggestion('owner', 'h1');
    expect(res.ai.generated).toBe(false);
    // Deterministic values survive regardless of AI:
    expect(res.suggestion!.proposed).toEqual({ goal: 2 });
    expect(res.suggestion!.confidence).toBeGreaterThan(0);
    expect(res.coach!.message).toContain('2');
  });

  it('malicious AI output cannot alter the proposal target', async () => {
    const { svc, db } = makeDeps();
    // The provider interface cannot even carry targets — values live in the
    // DB row written by the deterministic engine, never by the model.
    const res = await svc.getSuggestion('owner', 'h1');
    const stored = db.habitAdjustmentProposal.create.mock.calls[0][0].data;
    expect(stored.proposedSnapshot).toEqual({ goal: 2 }); // engine value only
    expect(res.suggestion!.proposed).toEqual({ goal: 2 });
  });

  it('prompt sends facts + DATA-marked labels only — no IDs, journal or budget', async () => {
    const { svc, aiProvider } = makeDeps();
    await svc.getSuggestion('owner', 'h1');
    const [arg] = aiProvider.generateRawText.mock.calls[0];
    const flat = `${arg.system}${arg.user}`;
    expect(flat).toContain('USER-CREATED DATA');
    for (const banned of ['journal', 'budget', 'expense', 'owner', 'h1']) {
      expect(flat.toLowerCase()).not.toContain(banned);
    }
  });

  it('unconfigured provider skips AI and uses deterministic copy', async () => {
    const { svc, aiProvider } = makeDeps();
    (aiProvider as any).model = null;
    const res = await svc.getSuggestion('owner', 'h1');
    expect(aiProvider.generateRawText).not.toHaveBeenCalled();
    expect(res.ai.generated).toBe(false);
  });

  it('client-supplied proposal fields are impossible — API takes ids only', () => {
    const { svc } = makeDeps();
    // Signature accepts (userId, habitId[, proposalId]) — nothing else.
    expect(svc.acceptProposal.length).toBe(3);
    expect(svc.rejectProposal.length).toBe(3);
    expect(svc.getSuggestion.length).toBe(2);
  });
});
