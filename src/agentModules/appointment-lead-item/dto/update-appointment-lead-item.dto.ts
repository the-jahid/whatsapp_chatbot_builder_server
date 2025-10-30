import { Transform } from 'class-transformer';
import {
  IsString,
  IsOptional,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateAppointmentLeadItemDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const v = value.trim();
    return v.length ? v : undefined;
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

