import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IdentityStatus, Prisma } from '@prisma/client';
import { DatabaseService } from '../../core/database/database.service';
import {
  calculateEvidencePoints,
  calculateIdentityLevel,
  EvidenceKindCounts,
} from '../../core/utils/evidence.utils';
import { CreateIdentityDto, UpdateIdentityDto } from './dto/identity.dto';

type Tx = Prisma.TransactionClient;
type Db = Tx | DatabaseService;

const identityInclude = {
  habitLinks: {
    include: {
      habit: {
        select: {
          id: true,
          title: true,
          icon: true,
          iconColor: true,
          iconBg: true,
          isArchived: true,
        },
      },
    },
  },
};

export interface IdentityProgress {
  evidencePoints: number;
  kindCounts: EvidenceKindCounts;
  level: number;
  levelTitle: string;
  nextLevelThreshold: number | null;
  pointsToNextLevel: number;
  progressToNextLevel: number | null;
  linkedHabits: number;
  completedOnDate: number;
}

interface EvidenceSnapshot {
  countsByHabitAndKind: Map<string, EvidenceKindCounts>;
  completedOnDate: Set<string>;
}

@Injectable()
export class IdentityService {
  constructor(private readonly databaseSvc: DatabaseService) {}

  private async ensureIdentity(userId: string, id: string) {
    const identity = await this.databaseSvc.identity.findFirst({
      where: { id, userId },
    });
    if (!identity)
      throw new NotFoundException(`Identity with ID ${id} not found`);
    return identity;
  }

  public async create(userId: string, data: CreateIdentityDto) {
    return this.databaseSvc.identity.create({
      data: { userId, ...data },
    });
  }

  /**
   * Lists identities with deterministic evidence summaries.
   *
   * Evidence is computed with bounded aggregate queries (counts grouped by
   * kind/habit) — the user's full completion history is never loaded into
   * memory, no matter how long they have used the app.
   *
   * @param date optional client-local `YYYY-MM-DD` used to compute
   *             "completed today" per identity. Never derived server-side.
   */
  public async findAll(
    userId: string,
    date?: string,
  ): Promise<Array<{ [key: string]: unknown } & IdentityProgress>> {
    const parsedDate = this.parseClientDate(date);
    const identities = await this.databaseSvc.identity.findMany({
      where: { userId },
      include: identityInclude,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });

    const snapshot = await this.evidenceSnapshot(
      this.databaseSvc as Db,
      identities.map((i) => i.id),
      parsedDate,
    );

    return identities.map((identity) => ({
      ...identity,
      ...this.progressFromSnapshot(identity, snapshot, parsedDate),
    }));
  }

  public async findOne(userId: string, id: string, date?: string) {
    const identity = await this.ensureIdentity(userId, id);
    const parsedDate = this.parseClientDate(date);
    const [full] = await this.databaseSvc.identity.findMany({
      where: { id: identity.id },
      take: 1,
      include: identityInclude,
    });
    const snapshot = await this.evidenceSnapshot(
      this.databaseSvc as Db,
      [identity.id],
      parsedDate,
    );
    return { ...full, ...this.progressFromSnapshot(full, snapshot, parsedDate) };
  }

  /** Accepts only strict `YYYY-MM-DD` client-local keys; never derives one. */
  private parseClientDate(date?: string): string | undefined {
    if (date === undefined) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('date must be formatted as YYYY-MM-DD');
    }
    return date;
  }

  public async update(userId: string, id: string, data: UpdateIdentityDto) {
    await this.ensureIdentity(userId, id);
    const { status, ...rest } = data;
    return this.databaseSvc.identity.update({
      where: { id },
      data: {
        ...rest,
        ...(status ? { status: status as IdentityStatus } : {}),
      },
    });
  }

  /**
   * Identities with behavioral evidence are archived, never hard-deleted:
   * historical completions must keep pointing at a real identity.
   * Unused identities can be removed outright.
   */
  public async delete(userId: string, id: string) {
    const identity = await this.ensureIdentity(userId, id);
    const hasEvidence = await this.hasEvidence(userId, identity.id);

    if (!hasEvidence) {
      const deleted = await this.databaseSvc.identity.delete({
        where: { id },
      });
      return { ...deleted, archived: false };
    }

    const archived = await this.databaseSvc.identity.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });
    return { ...archived, archived: true };
  }

  private async hasEvidence(userId: string, identityId: string) {
    const links = await this.databaseSvc.identityHabit.findMany({
      where: { identityId },
      select: { habitId: true },
    });
    if (links.length === 0) return false;
    const anyCompletion = await this.databaseSvc.completion.findFirst({
      where: {
        habitId: { in: links.map((l) => l.habitId) },
        status: true,
      },
      select: { id: true },
    });
    return anyCompletion !== null;
  }

  public async linkHabit(userId: string, identityId: string, habitId: string) {
    await this.ensureIdentity(userId, identityId);
    const habit = await this.databaseSvc.habit.findFirst({
      where: { id: habitId, userId },
    });
    if (!habit)
      throw new NotFoundException(`Habit with ID ${habitId} not found`);

    try {
      return await this.databaseSvc.identityHabit.create({
        data: { identityId, habitId },
      });
    } catch (err) {
      if ((err as Prisma.PrismaClientKnownRequestError)?.code === 'P2002') {
        throw new BadRequestException(
          'This habit is already associated with the identity',
        );
      }
      throw err;
    }
  }

  public async unlinkHabit(
    userId: string,
    identityId: string,
    habitId: string,
  ) {
    await this.ensureIdentity(userId, identityId);
    const link = await this.databaseSvc.identityHabit.findUnique({
      where: { identityId_habitId: { identityId, habitId } },
    });
    if (!link) {
      throw new NotFoundException(
        `Habit ${habitId} is not associated with identity ${identityId}`,
      );
    }
    await this.databaseSvc.identityHabit.delete({ where: { id: link.id } });
    return { success: true };
  }

  /**
   * Bounded evidence snapshot for the given identities.
   *
   * Two aggregate queries total (plus one date lookup when requested),
   * regardless of how many identities or completion rows exist:
   *  - counts grouped by (kind, habitId): at most 3 rows per habit
   *  - the day's completed habit ids: at most one row per habit for that day
   */
  private async evidenceSnapshot(
    db: Db,
    identityIds: string[],
    date?: string,
  ): Promise<EvidenceSnapshot> {
    if (identityIds.length === 0) {
      return { countsByHabitAndKind: new Map(), completedOnDate: new Set() };
    }
    const links = await db.identityHabit.findMany({
      where: { identityId: { in: identityIds } },
      select: { identityId: true, habitId: true },
    });
    const habitIds = [...new Set(links.map((l) => l.habitId))];
    if (habitIds.length === 0) {
      return { countsByHabitAndKind: new Map(), completedOnDate: new Set() };
    }

    const [grouped, dated] = await Promise.all([
      db.completion.groupBy({
        by: ['kind', 'habitId'],
        where: { habitId: { in: habitIds }, status: true },
        _count: { _all: true },
      }),
      date
        ? db.completion.findMany({
            where: { habitId: { in: habitIds }, date, status: true },
            select: { habitId: true },
          })
        : Promise.resolve([] as Array<{ habitId: string }>),
    ]);

    const countsByHabitAndKind = new Map<string, EvidenceKindCounts>();
    for (const row of grouped) {
      const entry =
        countsByHabitAndKind.get(row.habitId) ??
        ({ FULL: 0, MINIMUM: 0, EMERGENCY: 0 } as EvidenceKindCounts);
      entry[row.kind] += row._count._all;
      countsByHabitAndKind.set(row.habitId, entry);
    }

    return {
      countsByHabitAndKind,
      completedOnDate: new Set(dated.map((c) => c.habitId)),
    };
  }

  /** Pure aggregation of a snapshot into per-identity progress. */
  private progressFromSnapshot(
    identity: Prisma.IdentityGetPayload<{ include: typeof identityInclude }>,
    snapshot: EvidenceSnapshot,
    date?: string,
  ): IdentityProgress {
    const kindCounts: EvidenceKindCounts = { FULL: 0, MINIMUM: 0, EMERGENCY: 0 };
    let completedOnDate = 0;
    for (const link of identity.habitLinks) {
      if (date && snapshot.completedOnDate.has(link.habitId)) {
        completedOnDate += 1;
      }
      const counts = snapshot.countsByHabitAndKind.get(link.habitId);
      if (!counts) continue;
      kindCounts.FULL += counts.FULL;
      kindCounts.MINIMUM += counts.MINIMUM;
      kindCounts.EMERGENCY += counts.EMERGENCY;
    }

    const points = calculateEvidencePoints(kindCounts);
    const levelInfo = calculateIdentityLevel(points);

    return {
      evidencePoints: points,
      kindCounts,
      linkedHabits: identity.habitLinks.length,
      completedOnDate,
      ...levelInfo,
    };
  }
}
