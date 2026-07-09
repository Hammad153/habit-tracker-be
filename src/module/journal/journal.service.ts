import { Injectable, NotFoundException } from '@nestjs/common';
import { JournalMood } from '@prisma/client';
import { DatabaseService } from '../../core/database/database.service';
import { CreateJournalEntryDto, UpdateJournalEntryDto } from './dto/journal.dto';

@Injectable()
export class JournalService {
  constructor(private readonly databaseSvc: DatabaseService) {}

  /** Tags are matched case-insensitively client side, so store them normalized. */
  private normalizeTags(tags: string[]) {
    return Array.from(
      new Set(
        tags
          .map((tag) => tag.trim().replace(/^#/, '').toLowerCase())
          .filter(Boolean),
      ),
    );
  }

  private normalizeTitle(title?: string) {
    if (title === undefined) return undefined;
    return title.trim() || 'Untitled Entry';
  }

  private async ensureEntry(userId: string, id: string) {
    const entry = await this.databaseSvc.journalEntry.findFirst({
      where: { id, userId },
    });
    if (!entry) throw new NotFoundException(`Journal entry with ID ${id} not found`);
    return entry;
  }

  /** Pinned entries first, then most recent day, then most recently touched. */
  async entries(userId: string) {
    return this.databaseSvc.journalEntry.findMany({
      where: { userId },
      orderBy: [{ isPinned: 'desc' }, { date: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  async createEntry(userId: string, data: CreateJournalEntryDto) {
    return this.databaseSvc.journalEntry.create({
      data: {
        userId,
        title: this.normalizeTitle(data.title)!,
        date: data.date,
        mood: data.mood as JournalMood,
        content: data.content,
        tags: this.normalizeTags(data.tags ?? []),
        isFavorite: data.isFavorite ?? false,
        isPinned: data.isPinned ?? false,
        templateId: data.templateId,
        attachments: data.attachments ?? [],
      },
    });
  }

  async updateEntry(userId: string, id: string, data: UpdateJournalEntryDto) {
    await this.ensureEntry(userId, id);
    return this.databaseSvc.journalEntry.update({
      where: { id },
      data: {
        title: this.normalizeTitle(data.title),
        date: data.date,
        mood: data.mood as JournalMood | undefined,
        content: data.content,
        tags: data.tags ? this.normalizeTags(data.tags) : undefined,
        isFavorite: data.isFavorite,
        isPinned: data.isPinned,
        templateId: data.templateId,
        attachments: data.attachments,
      },
    });
  }

  async deleteEntry(userId: string, id: string) {
    await this.ensureEntry(userId, id);
    return this.databaseSvc.journalEntry.delete({ where: { id } });
  }

  /**
   * Flipped server-side from the stored value so two quick taps cannot race on a
   * stale client copy.
   */
  async toggleFavorite(userId: string, id: string) {
    const entry = await this.ensureEntry(userId, id);
    return this.databaseSvc.journalEntry.update({
      where: { id },
      data: { isFavorite: !entry.isFavorite },
    });
  }

  async togglePinned(userId: string, id: string) {
    const entry = await this.ensureEntry(userId, id);
    return this.databaseSvc.journalEntry.update({
      where: { id },
      data: { isPinned: !entry.isPinned },
    });
  }
}
