import { PartialType } from '@nestjs/mapped-types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export const TASK_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export const TASK_STATUSES = ['PENDING', 'COMPLETED'] as const;

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
}

export class UpdateDailyPlanDto extends PartialType(CreateDailyPlanDto) {}

export class CreateDailyPlanTaskDto {
  @ApiProperty({ example: 'daily-plan-id' })
  @IsString()
  @IsNotEmpty()
  dailyPlanId!: string;

  @ApiPropertyOptional({ example: 'habit-id' })
  @IsOptional()
  @IsString()
  habitId?: string;

  @ApiProperty({ example: 'Write project outline' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional({ example: 'First pass, no polishing.' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: TASK_PRIORITIES, example: 'HIGH' })
  @IsIn(TASK_PRIORITIES)
  priority!: string;

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

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateDailyPlanTaskDto extends PartialType(CreateDailyPlanTaskDto) {}

export class ReorderDailyPlanTasksDto {
  @ApiProperty({ type: [String], example: ['task-1', 'task-2'] })
  @IsString({ each: true })
  taskIds!: string[];
}
