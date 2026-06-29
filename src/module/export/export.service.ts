import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../core/database/database.service';

@Injectable()
export class ExportService {
  constructor(private readonly databaseSvc: DatabaseService) {}

  private async loadUserWithData(userId: string) {
    const user = await this.databaseSvc.user.findUnique({
      where: { id: userId },
      include: {
        habits: {
          include: { completions: { orderBy: { date: 'asc' } } },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** Structured JSON backup of the user's account and habit history. */
  public async getJson(userId: string) {
    const user = await this.loadUserWithData(userId);
    return {
      exportedAt: new Date().toISOString(),
      profile: {
        id: user.id,
        name: user.name,
        email: user.email,
        level: user.level,
        xp: user.xp,
        createdAt: user.createdAt,
      },
      habits: user.habits.map((h) => ({
        id: h.id,
        title: h.title,
        category: h.category,
        scheduleType: h.scheduleType,
        goal: h.goal,
        unit: h.unit,
        isArchived: h.isArchived,
        createdAt: h.createdAt,
        completions: h.completions.map((c) => ({
          date: c.date,
          status: c.status,
          value: c.value,
        })),
      })),
    };
  }

  /** Flat CSV of every completion, one row per habit/date. */
  public async getCsv(userId: string): Promise<string> {
    const user = await this.loadUserWithData(userId);

    const escape = (v: unknown): string => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const header = [
      'Habit',
      'Category',
      'Date',
      'Completed',
      'Value',
      'Unit',
    ];
    const rows: string[][] = [];
    for (const h of user.habits) {
      if (h.completions.length === 0) {
        rows.push([h.title, h.category ?? '', '', '', '', h.unit ?? '']);
        continue;
      }
      for (const c of h.completions) {
        rows.push([
          h.title,
          h.category ?? '',
          c.date,
          c.status ? 'yes' : 'no',
          String(c.value),
          h.unit ?? '',
        ]);
      }
    }

    return [header, ...rows]
      .map((cols) => cols.map(escape).join(','))
      .join('\n');
  }
}
