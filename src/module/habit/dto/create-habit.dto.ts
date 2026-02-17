import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateHabitDto {
  @ApiProperty({
    example: 'Drink Water',
    description: 'The title of the habit',
  })
  title: string;

  @ApiPropertyOptional({
    example: 'Stay hydrated',
    description: 'The description of the habit',
  })
  description?: string;

  @ApiPropertyOptional({ example: '💧', description: 'The icon of the habit' })
  icon?: string;

  @ApiPropertyOptional({
    example: '#3B82F6',
    description: 'The color of the habit',
  })
  color?: string;

  @ApiPropertyOptional({
    example: 'Daily',
    description: 'The frequency of the habit',
  })
  frequency?: string;

  @ApiPropertyOptional({
    example: 'High',
    description: 'The priority of the habit',
  })
  priority?: string;

  @ApiPropertyOptional({
    example: 'user-id',
    description: 'The ID of the user owning the habit',
  })
  userId?: string;

  @ApiProperty({
    example: '#3B82F6',
    description: 'The color of the icon',
  })
  iconColor: string;

  @ApiProperty({
    example: 'rgba(255,255,255,0.1)',
    description: 'The background color of the icon',
  })
  iconBg: string;
}
