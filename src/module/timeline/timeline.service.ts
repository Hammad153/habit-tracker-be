import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/core/database/database.service';

@Injectable()
export class TimelineService {
  constructor(private databaseSvc: DatabaseService) {}

  public async getTimeline(userId: string) {
    return this.databaseSvc.completion.findMany({
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
