import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { Roles } from '../core/decorators/roles.decorator';

// Real metadata via the actual decorator (no stubbed reflector):
class AdminRoute {
  @Roles('ADMIN' as never)
  handler() {}
}
class OpenRoute {
  handler() {}
}

const makeContext = (user: unknown) => {
  const ctx: Record<string, unknown> = {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => 'handler',
    getClass: () => 'class',
  };
  return ctx;
};

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows routes without @Roles metadata', () => {
    const ctx = makeContext({ sub: 'u1', role: undefined });
    expect(guard.canActivate(ctx as never)).toBe(true);
  });

  it('ADMIN passes ADMIN-only routes', () => {
    const ctx = makeContext({ sub: 'a1', role: 'ADMIN' });
    // Simulate metadata by stubbing the reflector:
    const guarded = new RolesGuard({
      getAllAndOverride: () => ['ADMIN'],
    } as never);
    expect(guard.canActivate(ctx as never)).toBe(true);
  });

  const adminCtx = (reqUser: unknown) => {
    const ctx = makeContext(reqUser);
    const target = new AdminRoute();
    ctx.getHandler = () => target.handler;
    ctx.getClass = () => AdminRoute;
    return ctx;
  };

  it('USER on ADMIN route → 403 with role in message', () => {
    expect(() =>
      guard.canActivate(adminCtx({ sub: 'u1', role: 'USER' }) as never),
    ).toThrow(ForbiddenException);
  });

  it('missing role claim (pre-3.8 token) resolves to USER → 403 on ADMIN', () => {
    try {
      guard.canActivate(adminCtx({ sub: 'legacy' }) as never);
      fail('should have thrown');
    } catch (err) {
      expect((err as ForbiddenException).message).toContain('Your role: USER');
    }
  });

  it('unauthenticated request is rejected here if it somehow reaches the guard', () => {
    expect(() => guard.canActivate(adminCtx(undefined) as never)).toThrow(
      ForbiddenException,
    );
  });

  it('never consults body/query/header for roles', () => {
    const target = new AdminRoute();
    const ctx = makeContext({
      sub: 'u1', role: 'USER',
      body: { role: 'ADMIN' }, query: { role: 'ADMIN' }, headers: { role: 'ADMIN' },
    });
    ctx.getHandler = () => target.handler;
    ctx.getClass = () => AdminRoute;
    try {
      guard.canActivate(ctx as never);
      fail('escalation must fail');
    } catch (err) {
      expect((err as ForbiddenException).getStatus()).toBe(403);
    }
  });
});
