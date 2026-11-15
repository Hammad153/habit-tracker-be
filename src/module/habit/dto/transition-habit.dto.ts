import { IsIn } from 'class-validator';

export class TransitionHabitDto {
  @IsIn(['ACTIVE', 'PAUSED', 'ARCHIVED', 'COMPLETED'])
  status!: 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'COMPLETED';
}
