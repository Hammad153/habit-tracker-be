import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../core/database/database.service';
import ExcelJS from 'exceljs';

@Injectable()
export class ExportService {
  constructor(private readonly databaseSvc: DatabaseService) {}

  private async loadUserWithData(userId: string) {
    const user = await this.databaseSvc.user.findUnique({
      where: { id: userId },
      include: {
        habits: {
          include: {
            completions: { orderBy: { date: 'asc' } },
            reminders: true,
          },
        },
        journalEntries: { orderBy: { createdAt: 'desc' } },
        budgets: {
          include: { expenses: true, breakdowns: true },
          orderBy: { createdAt: 'desc' },
        },
        expenses: { orderBy: { expenseDate: 'desc' } },
        incomes: { orderBy: { incomeDate: 'desc' } },
        expenseCategories: true,
        identities: { include: { habitLinks: { include: { habit: true } } } },
        dailyPlans: {
          include: { tasks: { orderBy: { sortOrder: 'asc' } } },
          orderBy: { planDate: 'desc' },
        },
        badges: { include: { badge: true } },
        rewardLedger: { orderBy: { createdAt: 'desc' } },
        streakFreezes: true,
        temptationBundles: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** Structured JSON backup of the user's full account data. */
  public async getJson(userId: string) {
    const user = await this.loadUserWithData(userId);
    return {
      exportedAt: this.fmtDateTime(new Date()),
      profile: {
        id: user.id,
        name: user.name,
        email: user.email,
        level: user.level,
        xp: user.xp,
        coins: user.coins,
        longestStreak: user.longestStreak,
        totalHabits: user.totalHabits,
        completionRate: user.completionRate,
        createdAt: this.fmtDateTime(user.createdAt),
      },
      habits: user.habits.map((h) => ({
        id: h.id,
        title: h.title,
        subtitle: h.subtitle,
        category: h.category,
        scheduleType: h.scheduleType,
        scheduleDays: h.scheduleDays,
        timesPerWeek: h.timesPerWeek,
        priority: h.priority,
        goal: h.goal,
        unit: h.unit,
        fullBehavior: h.fullBehavior,
        minimumBehavior: h.minimumBehavior,
        isArchived: h.isArchived,
        createdAt: this.fmtDateTime(h.createdAt),
        completions: h.completions.map((c) => ({
          date: c.date,
          status: c.status,
          value: c.value,
          kind: c.kind,
        })),
        reminders: h.reminders.map((r) => ({
          time: r.time,
          days: r.days,
          enabled: r.enabled,
        })),
      })),
      journal: user.journalEntries.map((j) => ({
        id: j.id,
        title: j.title,
        date: j.date,
        mood: j.mood,
        content: j.content,
        tags: j.tags,
        isFavorite: j.isFavorite,
        createdAt: this.fmtDateTime(j.createdAt),
      })),
      budgets: user.budgets.map((b) => ({
        id: b.id,
        title: b.title,
        amount: b.amount,
        periodType: b.periodType,
        startDate: this.fmtDate(b.startDate),
        endDate: this.fmtDate(b.endDate),
        expenses: b.expenses.map((e) => ({
          title: e.title,
          amount: e.amount,
          date: e.expenseDate,
        })),
      })),
      expenses: user.expenses.map((e) => ({
        id: e.id,
        title: e.title,
        amount: e.amount,
        date: this.fmtDateTime(e.expenseDate),
        category: e.categoryId,
      })),
      incomes: user.incomes.map((i) => ({
        id: i.id,
        title: i.title,
        amount: i.amount,
        date: this.fmtDateTime(i.incomeDate),
      })),
      identities: user.identities.map((id) => ({
        id: id.id,
        title: id.title,
        description: id.description,
        status: id.status,
        linkedHabits: id.habitLinks.map((lh) => lh.habit.title),
      })),
      dailyPlans: user.dailyPlans.map((dp) => ({
        id: dp.id,
        date: this.fmtDateTime(dp.planDate),
        title: dp.title,
        note: dp.note,
        tasks: dp.tasks.map((t) => ({
          title: t.title,
          description: t.description,
          priority: t.priority,
          status: t.status,
          startTime: t.startTime,
          endTime: t.endTime,
          durationMinutes: t.durationMinutes,
        })),
      })),
      badges: user.badges.map((ub) => ({
        title: ub.badge.title,
        description: ub.badge.description,
        type: ub.badge.type,
        earnedAt: this.fmtDateTime(ub.earnedAt),
      })),
      rewardLedger: user.rewardLedger.map((r) => ({
        id: r.id,
        amount: r.amount,
        type: r.type,
        description: r.description,
        createdAt: this.fmtDateTime(r.createdAt),
      })),
      streakFreezes: user.streakFreezes.map((sf) => ({
        habitId: sf.habitId,
        date: sf.date,
        cost: sf.cost,
      })),
    };
  }

  /** Flat CSV of every completion, one row per habit/date. */
  public async getCsv(userId: string): Promise<string> {
    const user = await this.loadUserWithData(userId);

    const escape = (v: unknown): string => {
      const s =
        typeof v === 'string'
          ? v
          : v === null || v === undefined
            ? ''
            : JSON.stringify(v) ?? '';
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

  /** Generate a multi-sheet Excel workbook and return the buffer. */
  public async getExcel(userId: string): Promise<Buffer> {
    const user = await this.loadUserWithData(userId);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Habit Tracker';
    workbook.created = new Date();

    // ── Profile sheet ──
    const profileSheet = workbook.addWorksheet('Profile');
    profileSheet.columns = [
      { header: 'Field', key: 'field', width: 25 },
      { header: 'Value', key: 'value', width: 40 },
    ];
    this.styleHeaderRow(profileSheet);
    const profileRows = [
      ['Name', user.name],
      ['Email', user.email],
      ['Level', user.level],
      ['Experience Points', user.xp],
      ['Coins', user.coins],
      ['Longest Streak (days)', user.longestStreak],
      ['Total Habits', user.totalHabits],
      ['Completion Rate', `${(user.completionRate * 100).toFixed(1)}%`],
      ['Member Since', this.fmtDate(user.createdAt)],
      ['Export Date', this.fmtDateTime(new Date())],
    ];
    profileRows.forEach(([field, value]) =>
      profileSheet.addRow({ field, value: String(value) }),
    );

    // ── Habits sheet ──
    const habitsSheet = workbook.addWorksheet('Habits');
    habitsSheet.columns = [
      { header: 'Habit', key: 'title', width: 30 },
      { header: 'Category', key: 'category', width: 18 },
      { header: 'Schedule', key: 'schedule', width: 20 },
      { header: 'Priority', key: 'priority', width: 12 },
      { header: 'Goal', key: 'goal', width: 10 },
      { header: 'Unit', key: 'unit', width: 12 },
      { header: 'Completions', key: 'completions', width: 14 },
      { header: 'Completion %', key: 'rate', width: 14 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Created', key: 'created', width: 16 },
    ];
    this.styleHeaderRow(habitsSheet);
    for (const h of user.habits) {
      const completed = h.completions.filter((c) => c.status).length;
      const total = h.completions.length || 1;
      habitsSheet.addRow({
        title: h.title,
        category: h.category ?? '',
        schedule: this.fmtSchedule(h),
        priority: h.priority ?? '',
        goal: h.goal,
        unit: h.unit ?? '',
        completions: completed,
        rate: `${((completed / total) * 100).toFixed(1)}%`,
        status: h.isArchived ? 'Archived' : 'Active',
        created: this.fmtDate(h.createdAt),
      });
    }

    // ── Completions sheet ──
    const compSheet = workbook.addWorksheet('Completions');
    compSheet.columns = [
      { header: 'Habit', key: 'habit', width: 30 },
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Completed', key: 'status', width: 12 },
      { header: 'Value', key: 'value', width: 10 },
      { header: 'Kind', key: 'kind', width: 14 },
      { header: 'Unit', key: 'unit', width: 12 },
    ];
    this.styleHeaderRow(compSheet);
    for (const h of user.habits) {
      for (const c of h.completions) {
        compSheet.addRow({
          habit: h.title,
          date: c.date,
          status: c.status ? 'Yes' : 'No',
          value: c.value,
          kind: c.kind,
          unit: h.unit ?? '',
        });
      }
    }

    // ── Journal sheet ──
    const journalSheet = workbook.addWorksheet('Journal');
    journalSheet.columns = [
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Title', key: 'title', width: 30 },
      { header: 'Mood', key: 'mood', width: 14 },
      { header: 'Content', key: 'content', width: 60 },
      { header: 'Tags', key: 'tags', width: 30 },
      { header: 'Favorite', key: 'fav', width: 10 },
    ];
    this.styleHeaderRow(journalSheet);
    for (const j of user.journalEntries) {
      journalSheet.addRow({
        date: j.date,
        title: j.title,
        mood: j.mood,
        content: j.content,
        tags: j.tags.join(', '),
        fav: j.isFavorite ? 'Yes' : 'No',
      });
    }

    // ── Finance sheet ──
    const financeSheet = workbook.addWorksheet('Finance');
    financeSheet.columns = [
      { header: 'Type', key: 'type', width: 10 },
      { header: 'Title', key: 'title', width: 30 },
      { header: 'Amount', key: 'amount', width: 14 },
      { header: 'Date', key: 'date', width: 16 },
      { header: 'Budget', key: 'budget', width: 20 },
      { header: 'Note', key: 'note', width: 30 },
    ];
    this.styleHeaderRow(financeSheet);
    for (const e of user.expenses) {
      financeSheet.addRow({
        type: 'Expense',
        title: e.title,
        amount: -e.amount,
        date: this.fmtDate(e.expenseDate),
        budget: '',
        note: '',
      });
    }
    for (const i of user.incomes) {
      financeSheet.addRow({
        type: 'Income',
        title: i.title,
        amount: i.amount,
        date: this.fmtDate(i.incomeDate),
        budget: '',
        note: '',
      });
    }

    // ── Identities sheet ──
    const identSheet = workbook.addWorksheet('Identities');
    identSheet.columns = [
      { header: 'Identity', key: 'title', width: 25 },
      { header: 'Description', key: 'desc', width: 40 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Linked Habits', key: 'habits', width: 50 },
    ];
    this.styleHeaderRow(identSheet);
    for (const ident of user.identities) {
      identSheet.addRow({
        title: ident.title,
        desc: ident.description ?? '',
        status: ident.status,
        habits: ident.habitLinks.map((lh) => lh.habit.title).join(', '),
      });
    }

    // ── Daily Plans sheet ──
    const plansSheet = workbook.addWorksheet('Daily Plans');
    plansSheet.columns = [
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Title', key: 'title', width: 25 },
      { header: 'Task', key: 'task', width: 30 },
      { header: 'Priority', key: 'priority', width: 12 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Start', key: 'start', width: 10 },
      { header: 'End', key: 'end', width: 10 },
      { header: 'Duration (min)', key: 'duration', width: 14 },
    ];
    this.styleHeaderRow(plansSheet);
    for (const dp of user.dailyPlans) {
      for (const t of dp.tasks) {
        plansSheet.addRow({
          date: this.fmtDate(dp.planDate),
          title: dp.title ?? '',
          task: t.title,
          priority: t.priority,
          status: t.status,
          start: t.startTime ?? '',
          end: t.endTime ?? '',
          duration: t.durationMinutes ?? '',
        });
      }
    }

    // ── Badges sheet ──
    const badgesSheet = workbook.addWorksheet('Badges');
    badgesSheet.columns = [
      { header: 'Badge', key: 'title', width: 25 },
      { header: 'Description', key: 'desc', width: 50 },
      { header: 'Type', key: 'type', width: 14 },
      { header: 'Earned At', key: 'earned', width: 18 },
    ];
    this.styleHeaderRow(badgesSheet);
    for (const ub of user.badges) {
      badgesSheet.addRow({
        title: ub.badge.title,
        desc: ub.badge.description,
        type: ub.badge.type,
        earned: this.fmtDate(ub.earnedAt),
      });
    }

    // ── Rewards sheet ──
    const rewardsSheet = workbook.addWorksheet('Rewards');
    rewardsSheet.columns = [
      { header: 'Date', key: 'date', width: 18 },
      { header: 'Type', key: 'type', width: 25 },
      { header: 'Amount', key: 'amount', width: 10 },
      { header: 'Description', key: 'desc', width: 50 },
    ];
    this.styleHeaderRow(rewardsSheet);
    for (const r of user.rewardLedger) {
      rewardsSheet.addRow({
        date: this.fmtDate(r.createdAt),
        type: r.type,
        amount: r.amount,
        desc: r.description ?? '',
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /** Generate a styled HTML report for PDF export. */
  public async getPdfHtml(userId: string): Promise<string> {
    const user = await this.loadUserWithData(userId);

    const habitRows = user.habits
      .map((h) => {
        const completed = h.completions.filter((c) => c.status).length;
        const total = h.completions.length || 1;
        const rate = ((completed / total) * 100).toFixed(1);
        return `
        <tr>
          <td>${this.escHtml(h.title)}</td>
          <td>${this.escHtml(h.category ?? '-')}</td>
          <td>${completed}</td>
          <td>${rate}%</td>
          <td>${h.isArchived ? 'Archived' : 'Active'}</td>
        </tr>`;
      })
      .join('');

    const journalRows = user.journalEntries
      .map(
        (j) => `
        <tr>
          <td>${this.fmtDate(j.date)}</td>
          <td>${this.escHtml(j.title)}</td>
          <td>${j.mood}</td>
          <td>${this.escHtml(j.content.substring(0, 120))}${j.content.length > 120 ? '...' : ''}</td>
        </tr>`,
      )
      .join('');

    const expenseTotal = user.expenses.reduce((s, e) => s + e.amount, 0);
    const incomeTotal = user.incomes.reduce((s, i) => s + i.amount, 0);

    const identityRows = user.identities
      .map(
        (id) => `
        <tr>
          <td>${this.escHtml(id.title)}</td>
          <td>${id.status}</td>
          <td>${id.habitLinks.map((lh) => lh.habit.title).join(', ') || '-'}</td>
        </tr>`,
      )
      .join('');

    const badgeRows = user.badges
      .map(
        (ub) => `
        <tr>
          <td>${this.escHtml(ub.badge.title)}</td>
          <td>${ub.badge.type}</td>
          <td>${this.fmtDate(ub.earnedAt)}</td>
        </tr>`,
      )
      .join('');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color:#1a1a2e; padding:32px; font-size:13px; line-height:1.5; }
  .header { text-align:center; margin-bottom:32px; padding-bottom:20px; border-bottom:3px solid #6C63FF; }
  .header h1 { font-size:26px; color:#6C63FF; margin-bottom:4px; }
  .header p { color:#666; font-size:12px; }
  h2 { font-size:18px; color:#6C63FF; margin:28px 0 12px; padding-bottom:6px; border-bottom:1px solid #e0e0e0; }
  .stats { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:24px; }
  .stat { flex:1; min-width:120px; background:#f5f5ff; border-radius:8px; padding:14px; text-align:center; }
  .stat .num { font-size:24px; font-weight:700; color:#6C63FF; }
  .stat .label { font-size:11px; color:#666; margin-top:2px; }
  table { width:100%; border-collapse:collapse; margin-bottom:20px; }
  th { background:#6C63FF; color:#fff; padding:8px 10px; text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; }
  td { padding:7px 10px; border-bottom:1px solid #eee; font-size:12px; }
  tr:nth-child(even) { background:#fafaff; }
  .footer { text-align:center; margin-top:40px; padding-top:16px; border-top:1px solid #ddd; color:#999; font-size:10px; }
  @media print { body { padding:16px; } }
</style>
</head>
<body>
<div class="header">
  <h1>Habit Tracker Report</h1>
  <p>${this.escHtml(user.name)} &middot; ${this.escHtml(user.email)} &middot; Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
</div>

<div class="stats">
  <div class="stat"><div class="num">${user.level}</div><div class="label">Level</div></div>
  <div class="stat"><div class="num">${user.xp}</div><div class="label">XP</div></div>
  <div class="stat"><div class="num">${user.coins}</div><div class="label">Coins</div></div>
  <div class="stat"><div class="num">${user.longestStreak}</div><div class="label">Best Streak</div></div>
  <div class="stat"><div class="num">${user.totalHabits}</div><div class="label">Total Habits</div></div>
  <div class="stat"><div class="num">${(user.completionRate * 100).toFixed(0)}%</div><div class="label">Completion Rate</div></div>
</div>

<h2>Habits</h2>
<table>
  <tr><th>Habit</th><th>Category</th><th>Completions</th><th>Rate</th><th>Status</th></tr>
  ${habitRows || '<tr><td colspan="5" style="text-align:center;color:#999">No habits yet</td></tr>'}
</table>

<h2>Journal</h2>
<table>
  <tr><th>Date</th><th>Title</th><th>Mood</th><th>Content</th></tr>
  ${journalRows || '<tr><td colspan="4" style="text-align:center;color:#999">No journal entries</td></tr>'}
</table>

<h2>Finance Summary</h2>
<div class="stats">
  <div class="stat"><div class="num" style="color:#e74c3c">-$${expenseTotal.toFixed(2)}</div><div class="label">Total Expenses</div></div>
  <div class="stat"><div class="num" style="color:#27ae60">+$${incomeTotal.toFixed(2)}</div><div class="label">Total Income</div></div>
  <div class="stat"><div class="num">${user.budgets.length}</div><div class="label">Budgets</div></div>
</div>

<h2>Identities</h2>
<table>
  <tr><th>Identity</th><th>Status</th><th>Linked Habits</th></tr>
  ${identityRows || '<tr><td colspan="3" style="text-align:center;color:#999">No identities</td></tr>'}
</table>

<h2>Badges</h2>
<table>
  <tr><th>Badge</th><th>Type</th><th>Earned</th></tr>
  ${badgeRows || '<tr><td colspan="3" style="text-align:center;color:#999">No badges yet</td></tr>'}
</table>

<div class="footer">
  Habit Tracker &mdash; Your data, your journey. Export generated on ${this.fmtDateTime(new Date())}
</div>
</body>
</html>`;
  }

  // ── Helpers ──

  private styleHeaderRow(sheet: ExcelJS.Worksheet) {
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF6C63FF' },
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 24;
  }

  /** "Aug 23, 2026" — for date-only fields */
  private fmtDate(d: Date | string): string {
    const dt = typeof d === 'string' ? new Date(d) : d;
    return dt.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  /** "Aug 23, 2026 at 9:54 PM" — for full timestamps */
  private fmtDateTime(d: Date | string): string {
    const dt = typeof d === 'string' ? new Date(d) : d;
    return dt.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  private fmtSchedule(h: any): string {
    if (h.scheduleType === 'specific_days' && h.scheduleDays?.length) {
      return h.scheduleDays.join(', ');
    }
    if (h.scheduleType === 'times_per_week') {
      return `${h.timesPerWeek}x / week`;
    }
    return h.scheduleType ?? h.frequency ?? 'Daily';
  }

  private escHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
