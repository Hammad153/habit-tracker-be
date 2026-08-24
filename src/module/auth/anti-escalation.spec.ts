import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateProfileDto } from '../profile/dto/update-profile.dto';
import {
  AdminEffectivenessQueryDto,
} from '../analytics/admin/dto/admin-effectiveness-query.dto';

/**
 * Phase 3.8 — anti-escalation regression.
 * No client-facing DTO accepts a `role`; whitelist stripping silently drops
 * it so Prisma writes can never receive role changes from user input.
 * The admin query DTO cannot inject thresholds/outcomes/sample sizes.
 */
describe('anti-escalation — role is never client-writable', () => {
  it('UpdateProfileDto strips a client-supplied role', () => {
    const dto = plainToInstance(
      UpdateProfileDto,
      { name: 'X', role: 'ADMIN' },
      { exposeUnsetFields: false },
    );
    const errors = validateSync(dto as never, { whitelist: true });
    expect((dto as { role?: string }).role).toBeUndefined();
    expect(errors.filter((e) => e.property === 'role')).toHaveLength(0);
  });

  it('admin analytics query DTO cannot inject thresholds, outcomes or types', () => {
    const dto = plainToInstance(
      AdminEffectivenessQueryDto,
      {
        from: '2026-06-01',
        to: '2026-06-30',
        minSample: 1,
        outcome: 'IMPROVED',
        type: 'REDUCE_TARGET',
      },
      { exposeUnsetFields: false },
    );
    // whitelist strips unknown fields (no error needed) — the transformed
    // instance must not carry any injection surface:
    validateSync(dto as never, { whitelist: true });
    const carried = dto as Record<string, unknown>;
    expect(carried.minSample).toBeUndefined();
    expect(carried.outcome).toBeUndefined();
    expect(carried.type).toBeUndefined();
    expect(Object.keys(carried).sort()).toEqual(['from', 'to']);
  });
});
