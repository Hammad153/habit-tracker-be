import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/core/database/database.service';

@Injectable()
export class AwardsService {
  constructor(private databaseSvc: DatabaseService) {}

  public async findAll() {
    return this.databaseSvc.badge.findMany();
  }

  public async findUserBadges(userId: string) {
    return this.databaseSvc.userBadge.findMany({
      where: { userId },
      include: { badge: true },
    });
  }

  public async findOne(id: string) {
    return this.databaseSvc.badge.findUnique({
      where: { id },
    });
  }
}
