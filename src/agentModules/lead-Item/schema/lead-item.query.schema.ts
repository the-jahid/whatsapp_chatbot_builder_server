import { z } from 'zod';

const sortable = ['name', 'description', 'createdAt', 'updatedAt'] as const;
export type LeadItemSortableFields = typeof sortable[number];

export const getAllLeadItemsQuerySchema = z.object({
  page: z.preprocess(v => (v == null ? 1 : Number(v)), z.number().int().min(1)).default(1),
  limit: z.preprocess(v => (v == null ? 10 : Number(v)), z.number().int().min(1).max(100)).default(10),
  sortBy: z.enum(sortable).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  name: z.string().trim().optional(),
  description: z.string().trim().optional(),
}).strict();
