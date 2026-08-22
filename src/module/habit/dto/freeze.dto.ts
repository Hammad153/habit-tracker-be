import { IsString, IsNotEmpty } from 'class-validator';

export class FreezeDto {
  @IsString()
  @IsNotEmpty()
  date: string;
}
