import { ForbiddenException } from '@nestjs/common';
import { RolesGuard } from './roles.guard';

const makeContext = (req: Record<string, unknown>) => ({
  switchToHttp: () => ({ getRequest: () => ({ user: req }) }),
  getHandler: () => 'handler',
  getClass: () => 'klass',
});

/** Stub reflector: roles metadata comes straight from the test. */
const guardWithRoles = (roles?: string[]) =>
  new RolesGuard({
    getAllAndOverride: () => roles,
  } as never);

describe('RolesGuard', () => {
  it('allows routes without @Roles metadata', () => {
    const guard = guardWithRoles(undefined);
    expect(guard.canActivate(makeContext({ sub: 'u1', role: 'USER' }) as never)).toBe(true);
  });

  it('ADMIN passes ADMIN-only routes', () => {
    const guard = guardWithRoles(['ADMIN']);
    expect(
      guard.canActivate(makeContext({ sub: 'a1', role: 'ADMIN' }) as never),
    ).toBe(true);
  });

  it('USER on ADMIN route -> 403 naming both required and actual role', () => {
    const guard = guardWithRoles(['ADMIN']);
    try {
      guard.canActivate(makeContext({ sub: 'u1', role: 'USER' }) as never);
      fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).message).toContain('Required roles: ADMIN');
      expect((err as ForbiddenException).message).toContain('Your role: USER');
    }
  });

  it('missing JWT role claim (pre-3.8 tokens) resolves to USER -> 403', () => {
    const guard = guardWithRoles(['ADMIN']);
    try {
      guard.canActivate(makeContext({ sub: 'legacy' }) as never);
      fail('should have thrown');
    } catch (err) {
      expect((err as ForbiddenException).message).toContain('Your role: USER');
    }
  });

  it('multi-role metadata allows either role', () => {
    const guard = guardWithRoles(['USER', 'ADMIN']);
    expect(guard.canActivate(makeContext({ sub: 'u1', role: 'USER' }) as never)).toBe(true);
    expect(guard.canActivate(makeContext({ sub: 'a1', role: 'ADMIN' }) as never)).toBe(true);
  });

  it('never consults body/query/header for role escalation', () => {
    const guard = guardWithRoles(['ADMIN']);
    const req = {
      sub: 'u1',
      role: 'USER',
      body: { role: 'ADMIN' },
      query: { role: 'ADMIN' },
      headers: { role: 'ADMIN' },
    };
    expect(() => guard.canActivate(makeContext(req) as never)).toThrow(
      ForbiddenException,
    );
    // And even a forged request.user.role stays authoritative from the claim:
    expect(() =>
      guard.canActivate(
        makeContext({ sub: 'u1', role: 'USER', injectedRole: 'ADMIN' }) as never,
      ),
    ).toThrow(ForbiddenException);
  });
});
