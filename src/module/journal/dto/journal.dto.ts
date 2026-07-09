import { PartialType } from '@nestjs/mapped-types';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JOURNAL_MOODS } from '../constants';

export class CreateJournalEntryDto {
  @ApiProperty({ example: 'Morning pages' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiProperty({
    example: '2026-07-09',
    description: 'Calendar day, YYYY-MM-DD',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date must be in YYYY-MM-DD format',
  })
  date!: string;

  @ApiProperty({ enum: JOURNAL_MOODS, example: 'reflective' })
  @IsIn(JOURNAL_MOODS)
  mood!: string;

  @ApiProperty({ example: 'Today I noticed...' })
  @IsString()
  content!: string;

  @ApiPropertyOptional({ type: [String], example: ['gratitude', 'morning'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isFavorite?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  @ApiPropertyOptional({ example: 'daily-reflection' })
  @IsOptional()
  @IsString()
  templateId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  attachments?: string[];
}

export class UpdateJournalEntryDto extends PartialType(CreateJournalEntryDto) {}
