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
   * Permanently deletes a user and all of their data. Runs in a transaction:
   * badges and habits are removed first (habits cascade to their completions),
   * then the user row itself. Required for privacy / app-store compliance.
   */
  public async deleteAccount(userId: string): Promise<void> {
    // Sequential deletes rather than $transaction([...]) — the pooled PrismaPg
    // adapter against the hosted DB times out acquiring a batch transaction.
    // Children are removed before the parent; deleting a habit cascades to its
    // completions at the DB level (Completion.onDelete = Cascade).
    await this.databaseSvc.userBadge.deleteMany({ where: { userId } });
    await this.databaseSvc.habit.deleteMany({ where: { userId } });
    await this.databaseSvc.user.delete({ where: { id: userId } });
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
}
