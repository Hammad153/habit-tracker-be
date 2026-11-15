import { validate } from 'class-validator';
import { ToggleCompletionDto } from './toggle-completion.dto';

describe('ToggleCompletionDto date', () => {
  const errorsFor = (date: string) => validate(Object.assign(new ToggleCompletionDto(), { date }));

  it('accepts a real canonical leap day', async () => {
    expect(await errorsFor('2024-02-29')).toHaveLength(0);
  });

  it.each(['2026-02-29', '2026-13-01', '2026-01-1', 'tomorrow', '2026-01-01T00:00:00Z'])('rejects %s', async (date) => {
    expect((await errorsFor(date)).length).toBeGreaterThan(0);
  });
});
