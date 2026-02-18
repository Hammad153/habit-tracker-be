import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { DatabaseService } from 'src/core/database/database.service';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { SALT_ROUND } from 'src/constants';

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
