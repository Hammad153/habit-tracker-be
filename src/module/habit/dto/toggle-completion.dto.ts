import { ApiProperty } from '@nestjs/swagger';

export class ToggleCompletionDto {
  @ApiProperty({
    example: '2024-03-20',
    description: 'The date for the completion',
  })
  date: string;
}
