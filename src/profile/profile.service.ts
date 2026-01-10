import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProfileService {
  constructor(private prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        _count: {
          select: { habits: true },
        },
      },
    });

    if (!user) {
      // Create a default user for now if it doesn't exist
      return this.prisma.user.create({
        data: {
          id: userId,
          name: 'Hammad Ismail',
          email: 'hammadismail2005@gmail.com',
        },
      });
    }

    return user;
  }

  async updateProfile(userId: string, data: any) {
    return this.prisma.user.update({
      where: { id: userId },
      data,
    });
  }
}
