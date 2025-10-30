import { Transform } from 'class-transformer';
import {
  IsString,
  IsUUID,
  IsOptional,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateAppointmentLeadItemDto {
  @IsUUID('4') @IsOptional() agentId?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const v = value.trim();
    return v.length ? v : undefined; // treat empty string as undefined
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
