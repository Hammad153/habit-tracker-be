import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { NOTIFICATION_TYPES } from '../../../core/utils/adaptive-cadence.constants';

export class DeliveryItemDto {
  @IsString()
  @Length(6, 128)
  fingerprint!: string;

  @IsIn(NOTIFICATION_TYPES as unknown as string[])
  type!: string;

  @IsIn(['URGENT', 'HIGH', 'NORMAL', 'LOW'])
  priority!: string;
}

export class MarkDeliveredDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => DeliveryItemDto)
  items!: DeliveryItemDto[];
}
