import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateCoachPreferencesDto } from './dto/coach-preferences.dto';
import { ProfileService } from './profile.service';
import { DatabaseService } from '../../core/database/database.service';

const makeSvc = () => {
  const db = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const svc = new ProfileService(db as unknown as DatabaseService);
  return { svc, db };
};

const VALID = {
  coachEnabled: true,
  aiCoachEnabled: false,
  coachTone: 'CALM',
  coachFrequency: 'MINIMAL',
  weeklyReviewEnabled: true,
};

describe('ProfileService — coach preferences (Phase 3.4)', () => {
  it('returns safe defaults when the user row lacks prefs', async () => {
    const { svc, db } = makeSvc();
    db.user.findUnique.mockResolvedValue(null);
    await expect(svc.getCoachPreferences('u1')).resolves.toEqual({
      coachEnabled: true,
      aiCoachEnabled: true,
      coachTone: 'BALANCED',
      coachFrequency: 'STANDARD',
      weeklyReviewEnabled: true,
    });
  });

  it('reads only the preference columns — never profile/credentials', async () => {
    const { svc, db } = makeSvc();
    db.user.findUnique.mockResolvedValue(VALID);
    await svc.getCoachPreferences('u1');
    expect(db.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        select: expect.not.objectContaining({ password: true, email: true }),
      }),
    );
  });

  it('persists updates scoped to the authenticated user and echoes them', async () => {
    const { svc, db } = makeSvc();
    db.user.findUnique.mockResolvedValue(VALID);
    const result = await svc.updateCoachPreferences('u1', VALID as any);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: VALID,
    });
    expect(result).toEqual(VALID);
  });

  it('DTO validation rejects invalid enum values before the service runs', () => {
    const bad = plainToInstance(UpdateCoachPreferencesDto, {
      ...VALID,
      coachTone: 'SCREAMING',
      coachFrequency: 'SOMETIMES',
    });
    const errors = validateSync(bad, { whitelist: true });
    const badProps = errors.map((e) => e.property);
    expect(badProps).toContain('coachTone');
    expect(badProps).toContain('coachFrequency');
  });

  it('DTO validation accepts every documented tone and frequency', () => {
    for (const tone of ['ENCOURAGING', 'DIRECT', 'CALM', 'CHALLENGING', 'BALANCED']) {
      for (const frequency of ['MINIMAL', 'STANDARD', 'FREQUENT']) {
        const dto = plainToInstance(UpdateCoachPreferencesDto, {
          ...VALID,
          coachTone: tone,
          coachFrequency: frequency,
        });
        expect(validateSync(dto, { whitelist: true })).toHaveLength(0);
      }
    }
  });

  it('never accepts a userId from the client payload', async () => {
    const { svc, db } = makeSvc();
    db.user.findUnique.mockResolvedValue(VALID);
    // The DTO has no userId field; whitelist-stripping proves it.
    const dto = plainToInstance(UpdateCoachPreferencesDto, {
      ...VALID,
      userId: 'someone-else',
    });
    validateSync(dto, { whitelist: true });
    expect('userId' in dto ? (dto as { userId?: string }).userId : undefined).toBeUndefined();
    await svc.updateCoachPreferences('victim-id', dto);
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'victim-id' } }),
    );
  });
});
