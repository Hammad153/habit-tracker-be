import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class VerifyPaymentDto {
  @ApiProperty({
    example: 'routina_a1b2c3d4e5f6g7h8',
    description: 'Paystack transaction reference returned by checkout',
  })
  @IsString()
  reference: string;
}