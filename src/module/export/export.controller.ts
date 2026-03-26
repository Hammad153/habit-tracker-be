import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { DatabaseService } from '../../core/database/database.service';

@ApiTags('Export')
@Controller('export')
export class ExportController {
  constructor(private databaseSvc: DatabaseService) {}

  @Get('csv')
  async exportCsv(
    @Query('userId') userId: string,
    @Res() res: Response,
  ) {
    const habits = await this.databaseSvc.habit.findMany({
      where: { userId },
      include: { completions: true },
      orderBy: { createdAt: 'asc' },
    });

    const headers = [
      'Habit',
      'Category',
      'Goal',
      'Unit',
      'Total Completions',
      'Created',
    ];
    const rows = habits.map((h) => [
      `"${h.title}"`,
      h.category || 'Uncategorized',
      h.goal,
      h.unit || 'times',
      h.completions.filter((c) => c.status).length,
      h.createdAt.toISOString().split('T')[0],
    ]);

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join(
      '\n',
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=habit-tracker-export-${new Date().toISOString().split('T')[0]}.csv`,
    );
    res.send(csv);
  }

  @Get('json')
  async exportJson(@Query('userId') userId: string) {
    const habits = await this.databaseSvc.habit.findMany({
      where: { userId },
      include: {
        completions: { orderBy: { date: 'desc' } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return {
      exportDate: new Date().toISOString(),
      totalHabits: habits.length,
      habits: habits.map((h) => ({
        title: h.title,
        category: h.category,
        goal: h.goal,
        unit: h.unit,
        schedule: h.scheduleType,
        totalCompletions: h.completions.filter((c) => c.status).length,
        created: h.createdAt,
        completions: h.completions,
      })),
    };
  }
}
