import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { IS_PUBLIC_KEY } from '../../core/decorators/public.decorator';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly authSvc: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException({
        code: 'NO_TOKEN',
        message: 'No token provided',
      });
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.authSvc.getJwtSecret(),
      });
      if (payload.token_type && payload.token_type !== 'access') {
        throw new UnauthorizedException({
          code: 'ACCESS_TOKEN_INVALID',
          message: 'Invalid access token',
        });
      }
      request['user'] = payload;
      return true;
    } catch (error: any) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException({
        code:
          error?.name === 'TokenExpiredError'
            ? 'ACCESS_TOKEN_EXPIRED'
            : 'ACCESS_TOKEN_INVALID',
        message: 'Invalid or expired token',
      });
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
