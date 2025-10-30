import { Transform } from 'class-transformer';
import {
  IsUUID,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  Max,
  IsInt,
} from 'class-validator';

export class QueryAppointmentLeadItemsDto {
 @IsUUID('4') @IsOptional() agentId?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsUUID('4')
  cursor?: string; // last seen item id

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number; // default in controller/service (e.g., 20)
}
