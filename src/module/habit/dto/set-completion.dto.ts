import { IsBoolean, IsIn, IsNumber, IsOptional, Min } from 'class-validator';
import { COMPLETION_KINDS } from './create-habit.dto';

export class SetCompletionDto {
  @IsBoolean()
  status!: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  value?: number;

  @IsOptional()
  @IsIn(COMPLETION_KINDS)
  kind?: string;
}
