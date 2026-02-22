import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ToggleCompletionDto {
  @ApiProperty({
    example: '2024-03-20',
    description: 'The date for the completion',
  })
  date: string;

  @ApiPropertyOptional({
    example: 15,
    description: 'The value logged for this completion',
  })
  value?: number;
}
