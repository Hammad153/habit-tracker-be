import { analyzeAdaptation } from './adaptive-analysis.utils';
import { buildBehaviorReport } from '../../../core/utils/behavior-analytics.utils';
const run = (endKey, count, kind = 'FULL') =>
  Array.from({ length: count }, (_, i) => {
    const d = new Date(endKey + 'T12:00:00.000Z');
    d.setUTCDate(d.getUTCDate() - i);
    return { date: d.toISOString().slice(0, 10), status: true, value: 1, kind };
  });

it('dbg', () => {
  const out = [
    ...run('2026-08-23', 6, 'MINIMUM'),
    { date: '2026-08-17', status: true, value: 1, kind: 'EMERGENCY' },
  ];
  for (let i = 8; i <= 29; i += 3) {
    const d = new Date('2026-08-23T12:00:00.000Z');
    d.setUTCDate(d.getUTCDate() - i);
    if (d.getUTCDay() === 4) continue;
    out.push({ date: d.toISOString().slice(0, 10), status: true, value: 1, kind: 'EMERGENCY' });
  }
  const report = buildBehaviorReport({ habit: { id: 'h1', scheduleType: 'daily' }, completions: out, todayKey: '2026-08-23' });
  const analysis = analyzeAdaptation(
    report,
    { goal: 5, unit: 'km', scheduleType: 'daily', timesPerWeek: null, scheduledTime: '20:00' },
    { fullBehavior: 'Run 5km', minimumBehavior: 'Walk', emergencyMinimum: null },
  );
  console.log('RESULT ' + JSON.stringify({
    minShare: report.kindMix30.minimum.share,
    fullShare: report.kindMix30.full.share,
    total: report.kindMix30.total,
    state: analysis.state,
    conf: analysis.confidence,
    signals: report.signals,
  }));
});
