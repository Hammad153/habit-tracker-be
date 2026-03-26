import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsArray, IsOptional, IsBoolean, Matches } from 'class-validator';

export class CreateReminderDto {
  @ApiProperty({ example: 'user-id' })
  @IsString()
  userId: string;

  @ApiProperty({ example: 'habit-id' })
  @IsString()
  habitId: string;

  @ApiProperty({ example: '08:00', description: 'Time in HH:mm format' })
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Time must be in HH:mm format' })
  time: string;

  @ApiProperty({
    example: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    description: 'Days of the week',
  })
  @IsArray()
  @IsString({ each: true })
  days: string[];

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateReminderDto {
  @ApiPropertyOptional({ example: '09:00' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Time must be in HH:mm format' })
  time?: string;

  @ApiPropertyOptional({ example: ['Mon', 'Wed', 'Fri'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  days?: string[];

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class RegisterPushTokenDto {
  @ApiProperty({ example: 'user-id' })
  @IsString()
  userId: string;

  @ApiProperty({ example: 'ExponentPushToken[...]' })
  @IsString()
  pushToken: string;
}
