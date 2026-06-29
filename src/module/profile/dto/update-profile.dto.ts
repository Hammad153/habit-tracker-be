import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Only safe, user-editable profile fields are allowed here. Sensitive columns
 * (password, email, xp, level, streak counters, refreshToken) are intentionally
 * excluded so this endpoint can never be used for privilege/score escalation.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Jane Doe' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/avatar.png' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatar?: string;
}
