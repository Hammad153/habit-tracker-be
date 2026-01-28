import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from 'src/module/users/users.service';
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

    const isMatch = await bcrypt.compare(pass, user.password as string);
    if (!isMatch) throw new UnauthorizedException('Invalid credentials');

    const tokens = await this.generateTokens(user);
    await this.userSvc.updateRefreshToken(user.id, tokens.refresh_token);

    return { ...tokens, user: this.sanitizeUser(user) };
  }

  async refreshToken(token: string) {
    try {
      const payload = await this.jwtSvc.verifyAsync(token, {
        secret:
          this.configSvc.get<string>('JWT_REFRESH_SECRET') || 'refresh-secret',
      });

      const isMatch = await this.userSvc.refreshTokenMatch(payload.sub, token);
      if (!isMatch)
        throw new UnauthorizedException('Invalid or expired refresh token');

      const user = await this.userSvc.findOne(payload.sub);
      if (!user) throw new UnauthorizedException('User not found');

      const newAccessToken = await this.jwtSvc.signAsync(
        { sub: user.id, email: user.email },
        {
          secret: this.configSvc.get<string>('JWT_SECRET'),
          expiresIn: (this.configSvc.get<string>('JWT_EXPIRES_IN') ||
            '1h') as any,
        },
      );

      return { access_token: newAccessToken };
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async logout(userId: string) {
    await this.userSvc.updateRefreshToken(userId, null);
  }

  private async generateTokens(user: User) {
    const payload = { sub: user.id, email: user.email };

    const access_token = await this.jwtSvc.signAsync(payload, {
      secret: this.configSvc.get<string>('JWT_SECRET'),
      expiresIn: (this.configSvc.get<string>('JWT_EXPIRES_IN') || '1h') as any,
    });

    const refresh_token = await this.jwtSvc.signAsync(payload, {
      secret:
        this.configSvc.get<string>('JWT_REFRESH_SECRET') || 'refresh-secret',
      expiresIn: (this.configSvc.get<string>('JWT_REFRESH_EXPIRES_IN') ||
        '7d') as any,
    });

    return { access_token, refresh_token };
  }

  private sanitizeUser(user: User) {
    const { password, refreshToken, ...rest } = user;
    return rest;
  }

  public getJwtSecret() {
    return this.configSvc.get<string>('JWT_SECRET');
  }
}
