import { IsOptional, IsString, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export class AdminEffectivenessQueryDto {
  @IsOptional()
  @IsString()
  @Matches(DAY_KEY, { message: 'from must be formatted as YYYY-MM-DD' })
  @ApiPropertyOptional({ example: '2026-06-01', description: 'Range start (inclusive), max 180 days.' })
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(DAY_KEY, { message: 'to must be formatted as YYYY-MM-DD' })
  @ApiPropertyOptional({ example: '2026-08-25', description: 'Range end (inclusive).' })
  to?: string;
}
