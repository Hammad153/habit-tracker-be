import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

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
}
