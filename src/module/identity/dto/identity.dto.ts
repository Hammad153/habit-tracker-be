import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsHexColor,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const IDENTITY_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;

export class CreateIdentityDto {
  @ApiProperty({
    example: 'Athlete',
    description:
      'Short name of the person the user is becoming, e.g. "Athlete", "Reader".',
    maxLength: 60,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  title!: string;

  @ApiPropertyOptional({
    example: 'I am becoming an athlete.',
    description: 'The identity statement shown back to the user.',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiPropertyOptional({ example: 'fitness', description: 'Icon name' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  icon?: string;

  @ApiPropertyOptional({
    example: '#3B82F6',
    description: 'Theme color used across the UI',
  })
  @IsOptional()
  @IsHexColor()
  color?: string;
}

export class UpdateIdentityDto {
  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  title?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  icon?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsHexColor()
  color?: string;

  @ApiPropertyOptional({
    enum: IDENTITY_STATUSES,
    description: 'Archiving preserves history while hiding the identity.',
  })
  @IsOptional()
  @IsIn(IDENTITY_STATUSES as unknown as string[])
  status?: string;
}

export class LinkIdentityHabitDto {
  @ApiProperty({ description: 'The habit to associate with this identity' })
  @IsString()
  @IsNotEmpty()
  habitId!: string;
}
