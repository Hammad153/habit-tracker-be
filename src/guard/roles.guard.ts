import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    //const requiredRoles = this.reflector.getAllAndOverride<[]>( [
    //  context.getHandler(),
    //  context.getClass(),
    //]);

    // If no @Roles decorator is present, allow access
    //if (!requiredRoles || requiredRoles.length === 0) {
    //  return true;
    //}

    const { user } = context.switchToHttp().getRequest();

    // If no user is present (AuthGuard didn't run or public route), allow through
    // The AuthGuard handles authentication; RolesGuard only handles authorization
    if (!user) {
      return true;
    }

    // Support both singular `role` (string) and `roles` (string[]) shaped payloads.
    //const userRole = (user.role as Role) ?? undefined;
    //const userRolesArray: Role[] | undefined =
    //  Array.isArray(user.roles) && user.roles.length > 0
    //    ? (user.roles as Role[])
    //    : userRole
    //      ? [userRole]
    //      : undefined;

    //    if (!userRolesArray) {
    //      throw new ForbiddenException('User has no assigned roles');
    //    }
    //
    //    const hasRequiredRole = requiredRoles.some((role) =>
    //      userRolesArray.includes(role),
    //    );

    //if (!hasRequiredRole) {
    //  throw new ForbiddenException(
    //    `Access denied. Required roles: ${requiredRoles.join(', ')}. Your role: join(', ')}`,
    //  );
    //}

    return true;
  }
}
