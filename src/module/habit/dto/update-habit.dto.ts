import { PartialType } from '@nestjs/swagger';
import { CreateHabitDto } from './create-habit.dto';
import { IsInt, IsOptional, Min } from 'class-validator';

export class UpdateHabitDto extends PartialType(CreateHabitDto) {
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}
