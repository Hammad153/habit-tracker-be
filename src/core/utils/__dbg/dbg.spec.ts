import { resolveWeeklyAnalysisDate } from '../week.utils';
it('dbg', () => {
  console.log('now:', new Date().toISOString());
  console.log(JSON.stringify(resolveWeeklyAnalysisDate('2099-01-04', null)));
});
