import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AwardsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.badge.findMany();
  }

  async findUserBadges(userId: string) {
    return this.prisma.userBadge.findMany({
      where: { userId },
      include: { badge: true },
    });
  }

  async findOne(id: string) {
    return this.prisma.badge.findUnique({
      where: { id },
    });
  }
}
