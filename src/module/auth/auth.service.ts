import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { MailerService } from '../mailer/mailer.service';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { User } from '@prisma/client';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly configSvc: ConfigService,
    private readonly jwtSvc: JwtService,
    private readonly userSvc: UsersService,
    private readonly mailerSvc: MailerService,
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

  async forgotPassword(email: string) {
    const user = await this.userSvc.findByEmail(email);

    // Always return success to prevent email enumeration attacks
    // The user won't know if the email exists or not
    if (!user) {
      this.logger.debug(
        `Forgot password requested for non-existent email: ${email}`,
      );
      return {
        message:
          'If an account with that email exists, we have sent a password reset link.',
      };
    }

    // Generate a secure reset token
    const resetToken = crypto.randomBytes(32).toString('hex');

    // Hash the token before storing it (for security)
    const hashedToken = await bcrypt.hash(resetToken, 10);

    // Set token expiry to 1 hour from now
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000);

    // Store the hashed token and expiry in the database
    await this.userSvc.updateResetToken(user.id, hashedToken, resetTokenExpiry);

    // Build the reset URL
    // In production, this would be your frontend app's reset password page
    // For now, we'll include the token in the email
    const appName = this.configSvc.get<string>('APP_NAME') || 'Habit Tracker';
    const resetUrl = `habittracker://reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;

    // Send the password reset email
    try {
      await this.mailerSvc.sendEmail({
        recipients: [email],
        subject: `${appName} — Password Reset Request`,
        html: this.buildPasswordResetEmail({
          appName,
          userName: user.name,
          resetToken,
          resetUrl,
          expiryHours: 1,
        }),
        text: this.buildPasswordResetEmailText({
          appName,
          userName: user.name,
          resetToken,
          resetUrl,
          expiryHours: 1,
        }),
      });
    } catch (err) {
      this.logger.error(`Failed to send password reset email to ${email}`, err);
      // Still return success to prevent email enumeration
      // The user can contact support if they don't receive the email
    }

    return {
      message:
        'If an account with that email exists, we have sent a password reset link.',
    };
  }

  async resetPassword(token: string, newPassword: string) {
    // Find user with a valid reset token that hasn't expired
    const user = await this.userSvc.findByResetToken(token);

    if (!user) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    // Check if the token has expired
    if (user.resetTokenExpiry && new Date() > user.resetTokenExpiry) {
      throw new UnauthorizedException(
        'Reset token has expired. Please request a new one.',
      );
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update the user's password and clear the reset token
    await this.userSvc.resetPassword(user.id, hashedPassword);

    return {
      message:
        'Your password has been reset successfully. You can now sign in with your new password.',
    };
  }

  private buildPasswordResetEmail(params: {
    appName: string;
    userName: string;
    resetToken: string;
    resetUrl: string;
    expiryHours: number;
  }): string {
    const { appName, userName, resetUrl, expiryHours } = params;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${appName} — Password Reset</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f4f5; margin: 0; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
    <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 32px 40px;">
      <h1 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 0;">${appName}</h1>
    </div>
    <div style="padding: 32px 40px;">
      <h2 style="color: #1f2937; font-size: 20px; font-weight: 600; margin: 0 0 16px;">Hi ${userName},</h2>
      <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
        We received a request to reset your password. If you didn't make this request, you can safely ignore this email — your password will remain unchanged.
      </p>
      <a href="${resetUrl}" style="display: inline-block; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 600; padding: 14px 28px; border-radius: 8px;">
        Reset Password
      </a>
      <p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin: 24px 0 0;">
        This link will expire in <strong>${expiryHours} hour${expiryHours > 1 ? 's' : ''}</strong>. If the button doesn't work, copy and paste this URL into your browser:
      </p>
      <p style="color: #9ca3af; font-size: 12px; word-break: break-all; margin: 8px 0 0;">${resetUrl}</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 28px 0;">
      <p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 0;">
        If you didn't request a password reset, please ignore this email or contact support if you have concerns.
      </p>
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  private buildPasswordResetEmailText(params: {
    appName: string;
    userName: string;
    resetToken: string;
    resetUrl: string;
    expiryHours: number;
  }): string {
    const { appName, userName, resetUrl, expiryHours } = params;

    return `
${appName} — Password Reset

Hi ${userName},

We received a request to reset your password. If you didn't make this request, you can safely ignore this email — your password will remain unchanged.

Reset your password by visiting this link:
${resetUrl}

This link will expire in ${expiryHours} hour${expiryHours > 1 ? 's' : ''}.

If you didn't request a password reset, please ignore this email or contact support if you have concerns.
    `.trim();
  }

  private async generateTokens(user: User) {
    const accessExpiresIn = (this.configSvc.get<string>('JWT_EXPIRES_IN') ||
      '1h') as any;
    const refreshExpiresIn = (this.configSvc.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
    ) || '7d') as any;

    const access_token = await this.jwtSvc.signAsync(
      {
        sub: user.id,
        email: user.email,
        token_type: 'access',
      },
      {
        secret: this.configSvc.get<string>('JWT_SECRET'),
        expiresIn: accessExpiresIn,
      },
    );

    const refresh_token = await this.jwtSvc.signAsync(
      {
        sub: user.id,
        email: user.email,
        token_type: 'refresh',
      },
      {
        secret: this.configSvc.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: refreshExpiresIn,
      },
    );

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
