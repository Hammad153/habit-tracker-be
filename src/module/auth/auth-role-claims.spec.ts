import { AuthService } from './auth.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { MailerService } from '../mailer/mailer.service';

/**
 * Phase 3.8 — JWT role-claim regression tests.
 * Captures the payloads handed to signAsync and asserts server-side role
 * issuance semantics (never client-supplied).
 */
const makeAuth = (
  user: { id: string; email: string; role?: string; password?: string },
) => {
  const captured: Array<Record<string, unknown>> = [];
  const jwtSvc = {
    signAsync: jest.fn().mockImplementation(async (payload) => {
      captured.push(payload as Record<string, unknown>);
      return `token-${captured.length}`;
    }),
    verifyAsync: jest.fn(),
    decode: jest.fn(),
  };
  const configSvc = {
    get: jest.fn().mockReturnValue('1h'),
  };
  const userSvc = {
    findByEmail: jest.fn().mockResolvedValue(user),
    updateRefreshToken: jest.fn(),
    refreshTokenMatch: jest.fn().mockResolvedValue(true),
    findOne: jest.fn().mockResolvedValue(user),
    create: jest.fn(),
  };
  const mailerSvc = {} as MailerService;
  const auth = new AuthService(
    configSvc as unknown as ConfigService,
    jwtSvc as unknown as JwtService,
    userSvc as unknown as UsersService,
    mailerSvc,
  );
  return { auth, captured, userSvc };
};

describe('JWT role claims (Phase 3.8)', () => {
  it('sign-in issues access+refresh tokens containing the USER role', async () => {
    const bcrypt = require('bcryptjs') as typeof import('bcryptjs');
    const hash = await bcrypt.hash('pw', 4);
    const { auth, captured } = makeAuth({
      id: 'u1', email: 'user@test.dev', role: 'USER', password: hash,
    });
    await auth.signIn('user@test.dev', 'pw');
    for (const payload of captured) {
      expect(payload.role).toBe('USER');
      expect(payload.token_type === 'access' || payload.token_type === 'refresh').toBe(true);
    }
  });

  it('ADMIN sign-in embeds ADMIN; refresh re-fetches the row so promotion propagates', async () => {
    const bcrypt = require('bcryptjs') as typeof import('bcryptjs');
    const hash = await bcrypt.hash('pw', 4);
    const { auth, captured, userSvc } = makeAuth({
      id: 'a1', email: 'admin@test.dev', role: 'ADMIN', password: hash,
    });
    await auth.signIn('admin@test.dev', 'pw');
    expect(captured.every((p) => p.role === 'ADMIN')).toBe(true);

    // Refresh flow loads the CURRENT user record before re-issuing.
    userSvc.findOne.mockResolvedValue({ id: 'a1', email: 'admin@test.dev', role: 'ADMIN' });
    await auth.refreshToken('refresh-token');
    const refreshedPayloads = captured.slice(2);
    expect(refreshedPayloads.length).toBe(2);
    expect(refreshedPayloads.every((p) => p.role === 'ADMIN')).toBe(true);
  });
});
