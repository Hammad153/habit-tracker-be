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

    return Promise.all(
      identities.map(async (identity) => ({
        ...identity,
        ...(await this.buildProgress(identity, userId, parsedDate)),
      })),
    );
  }

  public async findOne(userId: string, id: string, date?: string) {
    const identity = await this.ensureIdentity(userId, id);
    const progress = await this.buildProgress(
      await this.databaseSvc.identity.findFirstOrThrow({
        where: { id: identity.id },
        include: identityInclude,
      }),
      userId,
      this.parseClientDate(date),
    );
    return { ...identity, ...progress };
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
    const completions = await this.collectCompletions(
      this.databaseSvc as Db,
      userId,
      [identityId],
    );
    return completions.length > 0;
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
   * Aggregates every successful completion recorded against the habits
   * linked to the given identities. Evidence is always DERIVED from history;
   * there is no separate mutable score.
   */
  private async collectCompletions(
    db: Db,
    userId: string,
    identityIds: string[],
  ) {
    if (identityIds.length === 0) return [];
    const links = await db.identityHabit.findMany({
      where: { identityId: { in: identityIds } },
      select: { habitId: true, identityId: true },
    });
    const habitIds = [...new Set(links.map((l) => l.habitId))];
    if (habitIds.length === 0) return [];
    return db.completion.findMany({
      where: { habitId: { in: habitIds }, status: true },
      select: { kind: true, date: true, habitId: true },
    });
  }

  private async buildProgress(
    identity: Prisma.IdentityGetPayload<{ include: typeof identityInclude }>,
    userId: string,
    date?: string,
  ): Promise<IdentityProgress> {
    const completions = await this.collectCompletions(
      this.databaseSvc as Db,
      userId,
      [identity.id],
    );

    const kindCounts: EvidenceKindCounts = { FULL: 0, MINIMUM: 0, EMERGENCY: 0 };
    for (const completion of completions) {
      kindCounts[completion.kind] += 1;
    }

    let completedOnDate = 0;
    if (date) {
      const completedHabitIds = new Set(
        completions
          .filter((c) => c.date === date)
          .map((c) => c.habitId),
      );
      completedOnDate = completedHabitIds.size;
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
