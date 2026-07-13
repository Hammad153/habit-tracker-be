import { PartialType } from '@nestjs/mapped-types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const TASK_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export const TASK_STATUSES = ['PENDING', 'COMPLETED', 'SKIPPED'] as const;

export class CreateDailyPlanTaskDto {
  @ApiPropertyOptional({ example: 'daily-plan-id' })
  @IsOptional()
  @IsString()
  dailyPlanId?: string;

  @ApiPropertyOptional({ example: 'habit-id' })
  @IsOptional()
  @IsString()
  habitId?: string;

  @ApiPropertyOptional({ example: 'habit-id' })
  @IsOptional()
  @IsString()
  linkedHabitId?: string;

  @ApiProperty({ example: 'Write project outline' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional({ example: 'First pass, no polishing.' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: TASK_PRIORITIES, example: 'HIGH' })
  @IsOptional()
  @IsIn(TASK_PRIORITIES)
  priority?: string;

  @ApiPropertyOptional({ enum: TASK_STATUSES, example: 'PENDING' })
  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: string;

  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @IsString()
  startTime?: string;

  @ApiPropertyOptional({ example: '09:00' })
  @IsOptional()
  @IsString()
  endTime?: string;

  @ApiPropertyOptional({ example: 120 })
  @IsOptional()
  @IsInt()
  @Min(1)
  durationMinutes?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class UpdateDailyPlanTaskDto extends PartialType(CreateDailyPlanTaskDto) {}

export class CreateDailyPlanDto {
  @ApiProperty({ example: '2026-07-07' })
  @IsDateString()
  planDate!: string;

  @ApiPropertyOptional({ example: 'Focused Tuesday' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ example: 'Protect the first two hours for deep work.' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ type: () => [CreateDailyPlanTaskDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  @ValidateNested({ each: true })
  @Type(() => CreateDailyPlanTaskDto)
  items?: CreateDailyPlanTaskDto[];
}

export class UpdateDailyPlanDto extends PartialType(CreateDailyPlanDto) {}

export class ReorderDailyPlanTasksDto {
  @ApiProperty({ type: [String], example: ['task-1', 'task-2'] })
  @IsString({ each: true })
  taskIds!: string[];
}
