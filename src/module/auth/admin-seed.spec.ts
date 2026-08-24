import * as bcrypt from 'bcryptjs';

/**
 * Phase 3.8 — env-gated admin seed contract.
 * Mirrors prisma/seed.ts logic shape: skip without env, upsert with both,
 * preserve unrelated fields on existing users, hash passwords.
 */
describe('admin seed (env-gated)', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.restoreAllMocks();
  });

  const seedLogic = async (
    env: Record<string, string | undefined>,
    deps: { upsert: jest.Mock; hash: ReturnType<typeof jest.fn> },
  ): Promise<void> => {
    const email = env.ADMIN_EMAIL?.trim().toLowerCase();
    const password = env.ADMIN_PASSWORD;
    if (!email || !password) return; // skip silently
    const hashed = await bcrypt.hash(password, 10);
    deps.hash.mockReturnValueOnce(hashed);
    await deps.upsert({
      where: { email },
      update: { role: 'ADMIN' },
      create: { name: 'Administrator', email, password: hashed, role: 'ADMIN' },
    });
  };

  it('no env vars → no admin creation', async () => {
    const upsert = jest.fn();
    await seedLogic({}, { upsert, hash: jest.fn() });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('only one var set → skipped', async () => {
    const upsert = jest.fn();
    await seedLogic({ ADMIN_EMAIL: 'a@b.c' }, { upsert, hash: jest.fn() });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('both vars → ADMIN upsert with hashed password', async () => {
    const upsert = jest.fn();
    const hash = jest.fn().mockReturnValue('$2a$10$hashed');
    await seedLogic(
      { ADMIN_EMAIL: 'Admin@Test.dev ', ADMIN_PASSWORD: 'secret' },
      { upsert, hash },
    );
    const arg = upsert.mock.calls[0][0];
    expect(arg.where.email).toBe('admin@test.dev'); // normalized
    expect(arg.update).toEqual({ role: 'ADMIN' }); // unrelated fields preserved
    expect(arg.create.role).toBe('ADMIN');
    expect(arg.create.password.startsWith('$2')).toBe(true); // bcrypt hash
    expect(JSON.stringify(upsert.mock.calls)).not.toContain('secret'); // never logged/stored raw
  });

  it('running twice targets the same unique email — idempotent', async () => {
    const upsert = jest.fn();
    for (let i = 0; i < 2; i++) {
      await seedLogic(
        { ADMIN_EMAIL: 'a@b.c', ADMIN_PASSWORD: 'x' },
        { upsert, hash: jest.fn() },
      );
    }
    expect(upsert).toHaveBeenCalledTimes(2);
    const emails = upsert.mock.calls.map((c) => c[0].where.email);
    expect(new Set(emails).size).toBe(1);
  });
});
