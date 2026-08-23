import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateTemptationBundleDto {
  @ApiProperty({
    example: 'clr1habitid000',
    description: 'The habit this reward bundle is paired with',
  })
  @IsString()
  @IsNotEmpty()
  habitId: string;

  @ApiProperty({
    example: 'Gaming Session',
    description: 'What the user enjoys and earns after completing the habit',
  })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({
    example: 'One hour of the favorite game',
    description: 'Optional details about the reward',
  })
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateTemptationBundleDto {
  @ApiPropertyOptional({ example: 'Movie Night' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @ApiPropertyOptional({ example: 'Two episodes of the favorite show' })
  @IsOptional()
  @IsString()
  description?: string;
}
