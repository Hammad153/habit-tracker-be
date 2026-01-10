import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TimelineService {
  constructor(private prisma: PrismaService) {}

  async getTimeline(userId: string) {
    return this.prisma.completion.findMany({
      where: {
        habit: { userId },
      },
      include: {
        habit: true,
      },
      orderBy: {
        date: 'desc',
      },
    });
  }
}
