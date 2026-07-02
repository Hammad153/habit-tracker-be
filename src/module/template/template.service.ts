import { Injectable, NotFoundException } from '@nestjs/common';
import { HABIT_TEMPLATES, HabitTemplate } from './template.data';

@Injectable()
export class TemplateService {
  findAll(category?: string): HabitTemplate[] {
    const templates = [...HABIT_TEMPLATES].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
    if (category && category !== 'All') {
      return templates.filter((tpl) => tpl.category === category);
    }
    return templates;
  }

  getCategories(): string[] {
    return [...new Set(HABIT_TEMPLATES.map((tpl) => tpl.category))];
  }

  findOne(id: string): HabitTemplate {
    const template = HABIT_TEMPLATES.find((tpl) => tpl.id === id);
    if (!template) {
      throw new NotFoundException(`Template with ID ${id} not found`);
    }
    return template;
  }
}
