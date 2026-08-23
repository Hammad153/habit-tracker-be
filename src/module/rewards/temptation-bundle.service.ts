import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TemptationBundleStatus } from '@prisma/client';
import { DatabaseService } from '../../core/database/database.service';
import {
  CreateTemptationBundleDto,
  UpdateTemptationBundleDto,
} from './dto/temptation-bundle.dto';

type Tx = Prisma.TransactionClient;

/**
 * Temptation bundles — the "Make it Attractive" habit loop.
 *
 * Lifecycle: LOCKED -> UNLOCKED (automatic on a FULL completion of the
 * paired habit; see HabitService) -> USED (explicit user action here).
 *
 * Invariants:
 * - Every read/write is scoped to the owning user.
 * - Unlock is one-way and never re-locked (toggle-offs do not revert it).
 * - Only UNLOCKED bundles can be used; LOCKED and USED are terminal for
 *   this action. Bundles are single-use by design.
 */
@Injectable()
export class TemptationBundleService {
  constructor(private readonly databaseSvc: DatabaseService) {}

  public async create(userId: string, dto: CreateTemptationBundleDto) {
    const habit = await this.databaseSvc.habit.findFirst({
      where: { id: dto.habitId, userId },
      select: { id: true, isArchived: true },
    });
    if (!habit) throw new NotFoundException('Habit not found');
    if (habit.isArchived) {
      throw new BadRequestException(
        'Reward bundles cannot be added to archived habits',
      );
    }
    return this.databaseSvc.temptationBundle.create({
      data: {
        userId,
        habitId: dto.habitId,
        title: dto.title,
        description: dto.description ?? null,
      },
    });
  }

  public findAll(userId: string, habitId?: string) {
    return this.databaseSvc.temptationBundle.findMany({
      where: { userId, ...(habitId ? { habitId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  public async findOne(userId: string, id: string) {
    const bundle = await this.databaseSvc.temptationBundle.findFirst({
      where: { id, userId },
    });
    if (!bundle) throw new NotFoundException('Reward bundle not found');
    return bundle;
  }

  public async update(userId: string, id: string, dto: UpdateTemptationBundleDto) {
    await this.findOne(userId, id);
    const bundle = await this.databaseSvc.temptationBundle.findFirst({
      where: { id, userId },
      select: { status: true },
    });
    if (bundle?.status === TemptationBundleStatus.USED) {
      throw new BadRequestException('Used reward bundles cannot be edited');
    }
    return this.databaseSvc.temptationBundle.updateMany({
      where: { id, userId },
      data: dto,
    });
  }

  public async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    await this.databaseSvc.temptationBundle.deleteMany({ where: { id, userId } });
    return { deleted: true };
  }

  /**
   * Consumes an unlocked bundle. The conditional updateMany makes the
   * transition atomic: concurrent/duplicate use requests lose the guard
   * (count === 0) instead of corrupting state.
   */
  public async use(userId: string, id: string) {
    await this.findOne(userId, id);
    const result = await this.databaseSvc.temptationBundle.updateMany({
      where: { id, userId, status: TemptationBundleStatus.UNLOCKED },
      data: { status: TemptationBundleStatus.USED, usedAt: new Date() },
    });
    if (result.count === 0) {
      throw new BadRequestException(
        'Only unlocked reward bundles can be used',
      );
    }
    return this.databaseSvc.temptationBundle.findFirst({ where: { id, userId } });
  }

  /** Exposed for tests / future services needing a tx-bound variant. */
  public static unlockAllForHabitTx(tx: Tx, habitId: string): Promise<number> {
    return tx.temptationBundle
      .updateMany({
        where: { habitId, status: TemptationBundleStatus.LOCKED },
        data: { status: TemptationBundleStatus.UNLOCKED, unlockedAt: new Date() },
      })
      .then((r) => r.count);
  }
}
