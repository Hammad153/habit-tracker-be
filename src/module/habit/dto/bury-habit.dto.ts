import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class BuryHabitDto {
  @IsUUID()
  commandId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  epitaph?: string;

  @IsOptional()
  @IsIn(['stone', 'slate', 'midnight'])
  theme?: string;
}
