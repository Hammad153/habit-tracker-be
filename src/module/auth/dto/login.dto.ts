import { IsString, IsNotEmpty, IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'Password of the user' })
  password: string;

  @IsEmail()
  @IsNotEmpty()
  @ApiProperty({ description: 'Email of the user' })
  email: string;
}
