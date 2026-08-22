import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { COMPLETION_KINDS } from './create-habit.dto';

export class ToggleCompletionDto {
  @ApiProperty({
    example: '2024-03-20',
    description: 'The date for the completion (YYYY-MM-DD)',
  })
  @IsString()
  @IsNotEmpty()
  date: string;

  @ApiPropertyOptional({
    example: 15,
    description: 'The value logged for this completion',
  })
  @IsOptional()
  @IsNumber()
  value?: number;

  @ApiPropertyOptional({
    enum: COMPLETION_KINDS,
    description:
      'How the habit was completed. Defaults to FULL. MINIMUM requires the habit to define minimumBehavior; EMERGENCY requires emergencyMinimum.',
    example: 'FULL',
  })
  @IsOptional()
  @IsIn(COMPLETION_KINDS as unknown as string[])
  kind?: string;
}
