import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../core/decorators/roles.decorator';
import type { JwtRolePayload } from '../module/auth/auth.interface';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // No @Roles() metadata → route is not role-restricted.
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    // AuthGuard guarantees an authenticated user on non-public routes.
    if (!user) {
      throw new ForbiddenException('User has no assigned role');
    }

    const payload = user as JwtRolePayload;
    // Pre-3.8 tokens carry no role claim — resolve to USER (documented).
    const effectiveRole: Role =
      payload.role === 'ADMIN' ? 'ADMIN' : 'USER';

    if (!requiredRoles.includes(effectiveRole)) {
      throw new ForbiddenException(
        `Access denied. Required roles: ${requiredRoles.join(', ')}. Your role: ${effectiveRole}`,
      );
    }
    return true;
  }
}
