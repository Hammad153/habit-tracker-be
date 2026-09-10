import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogService } from './audit-log.service';
import { DatabaseService } from '../../../core/database/database.service';

describe('AuditLogService', () => {
  let service: AuditLogService;
  let db: any;

  beforeEach(async () => {
    db = {
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'log_1', action: 'USER_SUSPEND' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: DatabaseService, useValue: db },
      ],
    }).compile();

    service = module.get<AuditLogService>(AuditLogService);
  });

  it('should create an audit log entry', async () => {
    const res = await service.log({
      adminId: 'admin_1',
      action: 'USER_SUSPEND',
      targetType: 'USER',
      targetId: 'user_1',
      details: { reason: 'Violation' },
    });

    expect(db.auditLog.create).toHaveBeenCalled();
    expect(res).toEqual({ id: 'log_1', action: 'USER_SUSPEND' });
  });

  it('should query audit logs with pagination', async () => {
    const res = await service.getLogs({ page: 1, limit: 10 });
    expect(db.auditLog.findMany).toHaveBeenCalled();
    expect(res.page).toBe(1);
    expect(res.limit).toBe(10);
  });
});
