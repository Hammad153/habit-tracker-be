import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/core/database/database.service';

@Injectable()
export class ProfileService {
  constructor(private databaseSvc: DatabaseService) {}

  public async getProfile(userId: string) {
    const user = await this.databaseSvc.user.findUnique({
      where: { id: userId },
      include: {
        _count: {
          select: { habits: true },
        },
      },
    });

    if (!user) {
      return this.databaseSvc.user.create({
        data: {
          id: userId,
          name: 'Hammad Ismail',
          email: 'hammadismail2005@gmail.com',
          password: 'Welcome123',
        },
      });
    }

    return user;
  }

  public async updateProfile(userId: string, data: any) {
    return this.databaseSvc.user.update({
      where: { id: userId },
      data,
    });
  }
}
