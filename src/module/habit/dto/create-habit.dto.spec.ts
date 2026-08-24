import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateHabitDto } from './create-habit.dto';

const base = {
  title: 'Read',
  icon: 'book',
  iconColor: '#000000',
  iconBg: '#ffffff',
  goal: 20,
};

const validate = (payload: Record<string, unknown>) => {
  const dto = plainToInstance(CreateHabitDto, payload, {
    exposeUnsetFields: false,
  });
  const errors = validateSync(dto, { whitelist: true });
  return {
    errors,
    scheduledTime: (dto as unknown as { scheduledTime?: string }).scheduledTime,
  };
};

describe('CreateHabitDto — scheduledTime tolerance', () => {
  it('accepts strict HH:mm', () => {
    const { errors, scheduledTime } = validate({ ...base, scheduledTime: '20:00' });
    expect(errors.filter((e) => e.property === 'scheduledTime')).toHaveLength(0);
    expect(scheduledTime).toBe('20:00');
  });

  it('blank and whitespace-only values become undefined (optional), not 400', () => {
    const blank = validate({ ...base, scheduledTime: '' });
    expect(blank.errors).toHaveLength(0);
    expect(blank.scheduledTime).toBeUndefined();

    const spaced = validate({ ...base, scheduledTime: '   ' });
    expect(spaced.errors).toHaveLength(0);
  });

  it('trims surrounding whitespace around a valid time', () => {
    const { errors, scheduledTime } = validate({ ...base, scheduledTime: ' 07:30 ' });
    expect(errors.filter((e) => e.property === 'scheduledTime')).toHaveLength(0);
    expect(scheduledTime).toBe('07:30');
  });

  it('still rejects genuinely malformed times', () => {
    for (const bad of ['8pm', '7:30 after coffee', '25:00', '7:30']) {
      const { errors } = validate({ ...base, scheduledTime: bad });
      expect(errors.map((e) => e.property)).toContain('scheduledTime');
    }
  });

  it('undefined/null stay optional', () => {
    expect(validate(base).errors).toHaveLength(0);
    const withNull = validate({ ...base, scheduledTime: null });
    expect(withNull.errors.filter((e) => e.property === 'scheduledTime')).toHaveLength(0);
  });

  it('UpdateHabitDto inherits the same tolerance via PartialType', () => {
    const { UpdateHabitDto } =
      require('./update-habit.dto') as typeof import('./update-habit.dto');
    const dto = plainToInstance(
      UpdateHabitDto,
      { scheduledTime: '  ' },
      { exposeUnsetFields: false },
    );
    expect(validateSync(dto, { whitelist: true })).toHaveLength(0);
  });
});
