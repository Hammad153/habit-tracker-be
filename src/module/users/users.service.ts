import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { DatabaseService } from '../../core/database/database.service';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { SALT_ROUND } from '../../constants';

@Injectable()
export class UsersService {
  constructor(private readonly databaseSvc: DatabaseService) {}

  public async create(createUserDto: Prisma.UserCreateInput): Promise<User> {
    const passwordHashed = await bcrypt.hash(
      createUserDto.password,
      SALT_ROUND,
    );

    const existingEmail = await this.findByEmail(createUserDto.email);

    if (existingEmail) {
      throw new HttpException(
        'Email already in use',
        HttpStatus.NOT_ACCEPTABLE,
      );
    }

    return this.databaseSvc.user.create({
      data: {
        ...createUserDto,
        password: passwordHashed,
      },
    });
  }

  public async findByEmail(email: string): Promise<User | null> {
    return this.databaseSvc.user.findUnique({
      where: { email },
    });
  }

  public async findOne(id: string): Promise<User | null> {
    return this.databaseSvc.user.findUnique({
      where: { id },
    });
  }

  public async updateRefreshToken(
    userId: string,
    refreshToken: string | null,
  ): Promise<void> {
    const data: Prisma.UserUpdateInput = { refreshToken };

    if (refreshToken) {
      data.refreshToken = await bcrypt.hash(refreshToken, SALT_ROUND);
    }

    await this.databaseSvc.user.update({
      where: { id: userId },
      data,
    });
  }

  /**
   * Permanently deletes a user and all of their data atomically: badges and
   * habits are removed first (habits cascade to completions and reminders),
   * then the user row itself (cascades to journals, budgets, expenses, incomes
   * and daily plans). Required for privacy / app-store compliance.
   */
  public async deleteAccount(userId: string): Promise<void> {
    await this.databaseSvc.$transaction(
      async (tx) => {
        await tx.userBadge.deleteMany({ where: { userId } });
        await tx.habit.deleteMany({ where: { userId } });
        await tx.user.delete({ where: { id: userId } });
      },
      // Bulk deletes for data-heavy accounts can exceed the 5s default.
      { maxWait: 10_000, timeout: 30_000 },
    );
  }

  public async refreshTokenMatch(
    userId: string,
    providedToken: string,
  ): Promise<boolean> {
    const user = await this.databaseSvc.user.findUnique({
      where: { id: userId },
      select: { refreshToken: true },
    });

    if (!user || !user.refreshToken) return false;
    return await bcrypt.compare(providedToken, user.refreshToken);
  }

  /**
   * Stores a password-reset token digest and its expiry on the user record.
   * The raw token is only sent to the user's email and is never persisted.
   */
  public async updateResetToken(
    userId: string,
    tokenDigest: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.databaseSvc.user.update({
      where: { id: userId },
      data: {
        resetToken: tokenDigest,
        resetTokenExpiry: expiresAt,
      },
    });
  }

  /**
   * Finds a user whose reset-token digest is still valid.
   */
  public async findByResetTokenDigest(
    tokenDigest: string,
  ): Promise<User | null> {
    return this.databaseSvc.user.findFirst({
      where: {
        resetToken: tokenDigest,
        resetTokenExpiry: { gt: new Date() },
      },
    });
  }

  /**
   * Updates a user's password and clears the reset token fields.
   */
  public async resetPassword(
    userId: string,
    hashedPassword: string,
  ): Promise<void> {
    await this.databaseSvc.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        refreshToken: null,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });
  }
}
