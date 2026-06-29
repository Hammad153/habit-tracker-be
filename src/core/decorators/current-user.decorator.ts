import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * Resolves the authenticated user id (JWT `sub`) from the request.
 *
 * This is the single source of truth for "who is making this request". Never
 * trust a userId coming from the query string or request body — doing so is an
 * IDOR vulnerability. The AuthGuard populates `request.user` from the verified
 * access token, so this value is always the caller's own id.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const userId = request?.user?.sub;
    if (!userId) {
      throw new UnauthorizedException('Authenticated user not found on request');
    }
    return userId;
  },
);
