import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';
import { IsEmail as IsEmailValidator } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({
    description: 'The email address of the account to reset password for',
    example: 'user@example.com',
  })
  @IsEmailValidator({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty({
    description: 'The reset token received via email',
    example: 'abc123def456...',
  })
  @IsNotEmpty({ message: 'Reset token is required' })
  token: string;

  @ApiProperty({
    description: 'The new password to set',
    example: 'NewSecurePassword123!',
    minLength: 8,
  })
  @IsNotEmpty({ message: 'New password is required' })
  newPassword: string;
}
