import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export const SCHEDULE_TYPES = [
  'daily',
  'specific_days',
  'times_per_week',
  'interval',
] as const;

export class CreateHabitDto {
  @ApiProperty({
    example: 'Drink Water',
    description: 'The title of the habit',
  })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional({
    example: 'Stay hydrated',
    description: 'Short subtitle / description of the habit',
  })
  @IsOptional()
  @IsString()
  subtitle?: string;

  @ApiProperty({ example: 'water', description: 'The icon of the habit' })
  @IsString()
  @IsNotEmpty()
  icon!: string;

  @ApiProperty({
    example: '#3B82F6',
    description: 'The icon foreground color',
  })
  @IsString()
  @IsNotEmpty()
  iconColor!: string;

  @ApiProperty({
    example: 'rgba(255,255,255,0.1)',
    description: 'The icon background color',
  })
  @IsString()
  @IsNotEmpty()
  iconBg!: string;

  @ApiPropertyOptional({
    example: 'Health',
    description: 'The category of the habit',
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({
    example: 'Daily',
    description: 'Legacy free-text frequency label',
  })
  @IsOptional()
  @IsString()
  frequency?: string;

  @ApiPropertyOptional({
    example: 'daily',
    enum: SCHEDULE_TYPES,
    description: 'How the habit is scheduled',
  })
  @IsOptional()
  @IsIn(SCHEDULE_TYPES)
  scheduleType?: string;

  @ApiPropertyOptional({
    example: ['Mon', 'Wed', 'Fri'],
    description: 'Days the habit runs when scheduleType = "specific_days"',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scheduleDays?: string[];

  @ApiPropertyOptional({
    example: 3,
    description: 'Target count when scheduleType = "times_per_week"',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  timesPerWeek?: number;

  @ApiPropertyOptional({
    example: 2,
    description: 'Gap in days when scheduleType = "interval"',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  intervalDays?: number;

  @ApiPropertyOptional({
    example: 'High',
    description: 'The priority of the habit',
  })
  @IsOptional()
  @IsString()
  priority?: string;

  @ApiPropertyOptional({
    example: 30,
    description: 'The daily goal value',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  goal?: number;

  @ApiPropertyOptional({
    example: 'pushups',
    description: 'The unit for the goal',
  })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional({
    example: 'user-id',
    description: 'The ID of the user owning the habit',
  })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({
    example: '2024-01-01T00:00:00.000Z',
    description: 'Optional start date for temporary habits',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    example: '2024-12-31T23:59:59.999Z',
    description:
      'Optional end date - habit will be auto-deleted after this date',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
