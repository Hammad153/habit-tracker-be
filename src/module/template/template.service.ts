import { Injectable } from '@nestjs/common';
import { HabitTemplate, SubscriptionTier } from '@prisma/client';
import { DatabaseService } from '../../core/database/database.service';

@Injectable()
export class TemplateService {
  constructor(private databaseSvc: DatabaseService) {}

  public async findAll(tier?: SubscriptionTier): Promise<HabitTemplate[]> {
    return this.databaseSvc.habitTemplate.findMany({
      orderBy: { sortOrder: 'asc' },
    });
  }

  public async findByCategory(category: string): Promise<HabitTemplate[]> {
    return this.databaseSvc.habitTemplate.findMany({
      where: { category },
      orderBy: { sortOrder: 'asc' },
    });
  }

  public async findOne(id: string): Promise<HabitTemplate | null> {
    return this.databaseSvc.habitTemplate.findUnique({
      where: { id },
    });
  }

  public async getCategories(): Promise<string[]> {
    const templates = await this.databaseSvc.habitTemplate.findMany({
      select: { category: true },
      distinct: ['category'],
      orderBy: { sortOrder: 'asc' },
    });
    return templates.map((t) => t.category);
  }
}
