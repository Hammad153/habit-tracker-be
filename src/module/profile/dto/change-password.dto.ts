import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({
    example: 'OldPassword123!',
    description: 'Individual current password',
  })
  @IsNotEmpty()
  @IsString()
  oldPassword: string;

  @ApiProperty({
    example: 'NewPassword123!',
    description: 'Individual new password',
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  newPassword: string;

  @ApiProperty({
    example: 'NewPassword123!',
    description: 'Individual new password confirmation',
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  confirmPassword: string;
}
