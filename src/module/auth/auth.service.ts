import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcryptjs';
import { User } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private readonly configSvc: ConfigService,
    private readonly jwtSvc: JwtService,
    private readonly userSvc: UsersService,
  ) {}

  async signUp(data: any) {
    const user = await this.userSvc.create(data);
    const tokens = await this.generateTokens(user);
    await this.userSvc.updateRefreshToken(user.id, tokens.refresh_token);
    return { ...tokens, user: this.sanitizeUser(user) };
  }

  async signIn(email: string, pass: string) {
    const user = await this.userSvc.findByEmail(email);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const isMatch = await bcrypt.compare(pass, user.password);
    if (!isMatch) throw new UnauthorizedException('Invalid credentials');

    const tokens = await this.generateTokens(user);
    await this.userSvc.updateRefreshToken(user.id, tokens.refresh_token);

    return { ...tokens, user: this.sanitizeUser(user) };
  }

  async refreshToken(token: string) {
    if (!token) {
      throw this.authError(
        'REFRESH_TOKEN_INVALID',
        'Your session has expired. Please sign in again.',
      );
    }

    try {
      const payload = await this.jwtSvc.verifyAsync(token, {
        secret: this.configSvc.get<string>('JWT_REFRESH_SECRET'),
      });

      if (payload.token_type && payload.token_type !== 'refresh') {
        throw this.authError(
          'REFRESH_TOKEN_INVALID',
          'Your session has expired. Please sign in again.',
        );
      }

      const isMatch = await this.userSvc.refreshTokenMatch(payload.sub, token);
      if (!isMatch)
        throw this.authError(
          'REFRESH_TOKEN_REVOKED',
          'Your session has expired. Please sign in again.',
        );

      const user = await this.userSvc.findOne(payload.sub);
      if (!user)
        throw this.authError(
          'SESSION_NOT_FOUND',
          'Your session has expired. Please sign in again.',
        );

      const tokens = await this.generateTokens(user);
      await this.userSvc.updateRefreshToken(user.id, tokens.refresh_token);
      return tokens;
    } catch (err: any) {
      if (err instanceof UnauthorizedException) throw err;
      const code =
        err?.name === 'TokenExpiredError'
          ? 'REFRESH_TOKEN_EXPIRED'
          : 'REFRESH_TOKEN_INVALID';
      throw this.authError(
        code,
        'Your session has expired. Please sign in again.',
      );
    }
  }

  async logout(userId: string) {
    await this.userSvc.updateRefreshToken(userId, null);
  }

  private async generateTokens(user: User) {
    const accessExpiresIn = (this.configSvc.get<string>('JWT_EXPIRES_IN') ||
      '1h') as any;
    const refreshExpiresIn = (this.configSvc.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
    ) || '7d') as any;

    const access_token = await this.jwtSvc.signAsync({
      sub: user.id,
      email: user.email,
      token_type: 'access',
    }, {
      secret: this.configSvc.get<string>('JWT_SECRET'),
      expiresIn: accessExpiresIn,
    });

    const refresh_token = await this.jwtSvc.signAsync({
      sub: user.id,
      email: user.email,
      token_type: 'refresh',
    }, {
      secret: this.configSvc.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: refreshExpiresIn,
    });

    return { access_token, refresh_token, expires_in: accessExpiresIn };
  }

  private sanitizeUser(user: User) {
    const safe = { ...user } as Partial<User>;
    delete safe.password;
    delete safe.refreshToken;
    return safe;
  }

  public getJwtSecret() {
    return this.configSvc.get<string>('JWT_SECRET');
  }

  private authError(code: string, message: string) {
    return new UnauthorizedException({ code, message });
  }
}
