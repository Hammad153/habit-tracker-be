import { Test, TestingModule } from '@nestjs/testing';
import { HabitService } from './habit.service';
import { DatabaseService } from 'src/core/database/database.service';

describe('HabitService', () => {
  let service: HabitService;
  let databaseSvc: DatabaseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HabitService,
        {
          provide: DatabaseService,
          useValue: {
            completion: {
              findUnique: jest.fn(),
              findUniqueOrThrow: jest.fn(),
              create: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<HabitService>(HabitService);
    databaseSvc = module.get<DatabaseService>(DatabaseService);
  });

  it('should handle P2002 error in toggleCompletion', async () => {
    const habitId = 'habit-1';
    const date = '2026-02-21';
    const completion = { id: 'comp-1', habitId, date, status: true };

    // 1. First call: existing is null
    (databaseSvc.completion.findUnique as jest.Mock).mockResolvedValueOnce(
      null,
    );

    // 2. Mock create to throw P2002
    (databaseSvc.completion.create as jest.Mock).mockRejectedValueOnce({
      code: 'P2002',
    });

    // 3. Second findUniqueOrThrow to return the completion created by "someone else"
    (
      databaseSvc.completion.findUniqueOrThrow as jest.Mock
    ).mockResolvedValueOnce(completion);

    const result = await service.toggleCompletion(habitId, date);

    expect(result).toEqual(completion);
    expect(databaseSvc.completion.create).toHaveBeenCalled();
    expect(databaseSvc.completion.findUnique).toHaveBeenCalledTimes(1);
    expect(databaseSvc.completion.findUniqueOrThrow).toHaveBeenCalledTimes(1);
  });
});
