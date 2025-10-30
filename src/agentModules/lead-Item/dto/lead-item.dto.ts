import { z } from 'zod';
import {
  createLeadItemSchema,
  updateLeadItemSchema,
} from '../schema/lead-item.schema';
import { getAllLeadItemsQuerySchema } from '../schema/lead-item.query.schema';

/** Create / Update DTOs inferred from Zod */
export type CreateLeadItemDto = z.infer<typeof createLeadItemSchema>;
export type UpdateLeadItemDto = z.infer<typeof updateLeadItemSchema>;

/** Query DTO for list endpoint (validated via Zod pipe) */
export type GetAllLeadItemsQueryDto = z.infer<typeof getAllLeadItemsQuerySchema>;
