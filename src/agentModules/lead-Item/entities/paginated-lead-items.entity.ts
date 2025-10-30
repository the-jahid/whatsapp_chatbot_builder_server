import { ApiProperty } from '@nestjs/swagger';
import { LeadItemEntity } from './lead-item.entity';

export class PaginatedLeadItemsEntity {
  @ApiProperty({ type: [LeadItemEntity] })
  data!: LeadItemEntity[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  totalPages!: number;
}
