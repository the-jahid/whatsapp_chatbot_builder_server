import { z } from 'zod';

/** Single source of truth for a LeadItem */
export const leadItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, { message: 'Lead item name cannot be empty' }),
  description: z.string().trim().optional().nullable(),
  agentId: z.string().uuid({ message: 'Invalid agent ID' }),
  createdAt: z.date(),
  updatedAt: z.date(),
}).strict();

/** Create payload: omit db-managed fields */
export const createLeadItemSchema = leadItemSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

/** Update payload: partial over create */
export const updateLeadItemSchema = createLeadItemSchema.partial();
