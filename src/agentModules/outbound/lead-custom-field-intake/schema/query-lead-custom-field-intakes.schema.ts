import { z } from 'zod';
import { UUID_ANY } from './lead-custom-field-intake.schema';

export const QueryLeadCustomFieldIntakesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20).optional(),

  // optional filter (useful if you ever support ?campaignId=...; normally path param)
  outboundCampaignId: UUID_ANY.optional(),

  q: z.string().trim().min(1).max(64).optional(), // search by name

  sortBy: z.enum(['createdAt', 'name']).default('createdAt').optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc').optional(),
});

export type QueryLeadCustomFieldIntakesInput = z.infer<typeof QueryLeadCustomFieldIntakesSchema>;
