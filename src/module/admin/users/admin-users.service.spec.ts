import { Test, TestingModule } from '@nestjs/testing';
import { AdminUsersService } from './admin-users.service';
import { DatabaseService } from '../../../core/database/database.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('AdminUsersService', () => {
  let service: AdminUsersService;
  let db: any;
  let auditLogSvc: any;

  beforeEach(async () => {
    db = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'u1',
            name: 'User One',
            email: 'u1@test.com',
            role: 'USER',
            isSuspended: false,
            coins: 100,
            createdAt: new Date(),
            updatedAt: new Date(),
            _count: { habits: 2, rewardRedemptions: 1 },
            subscription: null,
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === 'u1') {
            return Promise.resolve({
              id: 'u1',
              name: 'User One',
              email: 'u1@test.com',
              role: 'USER',
              isSuspended: false,
              coins: 100,
              level: 1,
              xp: 50,
              longestStreak: 5,
              totalHabits: 2,
              completionRate: 0.8,
              createdAt: new Date(),
              updatedAt: new Date(),
              subscription: null,
              habits: [],
              rewardRedemptions: [],
              rewardLedger: [],
            });
          }
          return Promise.resolve(null);
        }),
        update: jest.fn().mockResolvedValue({
          id: 'u1',
          isSuspended: true,
        }),
      },
      auditLog: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    auditLogSvc = {
      log: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminUsersService,
        { provide: DatabaseService, useValue: db },
        { provide: AuditLogService, useValue: auditLogSvc },
      ],
    }).compile();

    service = module.get<AdminUsersService>(AdminUsersService);
  });

  it('should list users with pagination and formatting', async () => {
    const res = await service.getUsers({ page: 1, limit: 10 });
    expect(res.items.length).toBe(1);
    expect(res.items[0].email).toBe('u1@test.com');
  });

  it('should return User 360 data for existing user', async () => {
    const res = await service.getUser360('u1');
    expect(res.profile.email).toBe('u1@test.com');
    expect(res.profile.coins).toBe(100);
  });

  it('should throw NotFoundException if user 360 does not exist', async () => {
    await expect(service.getUser360('non_existent')).rejects.toThrow(NotFoundException);
  });

  it('should throw BadRequestException if admin tries to suspend self', async () => {
    await expect(
      service.setUserStatus('admin1', 'admin1', { isSuspended: true }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should suspend user and log audit event', async () => {
    const res = await service.setUserStatus('admin1', 'u1', { isSuspended: true, reason: 'Spam' });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { isSuspended: true },
      select: expect.any(Object),
    });
    expect(auditLogSvc.log).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'admin1',
        action: 'USER_SUSPEND',
        targetType: 'USER',
        targetId: 'u1',
      }),
    );
  });
});
