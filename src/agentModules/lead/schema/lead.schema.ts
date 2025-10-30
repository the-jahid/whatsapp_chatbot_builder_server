// /src/leads/schemas/lead.schema.ts

import { z } from 'zod';
import { LeadStatus } from '@prisma/client';

// Helper for Prisma's Json type. It can be any valid JSON.
const literalSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
type Literal = z.infer<typeof literalSchema>;
type Json = Literal | { [key: string]: Json } | Json[];
const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([literalSchema, z.array(jsonSchema), z.record(jsonSchema)])
);

/**
 * @const createLeadSchema
 * @description Zod schema for validating the data when creating a new lead.
 * Ensures that `agentId` is a valid UUID and that other fields match their expected types.
 */
export const createLeadSchema = z.object({
  agentId: z.string().uuid({ message: 'Agent ID must be a valid UUID.' }),
  source: z.string().optional().nullable(),
  data: jsonSchema.optional().nullable(),
});

/**
 * @const updateLeadSchema
 * @description Zod schema for validating the data when updating an existing lead.
 * It uses `.partial()` to make all fields optional for partial updates.
 * The `status` field is validated against the `LeadStatus` enum values.
 */
export const updateLeadSchema = z.object({
    status: z.nativeEnum(LeadStatus, {
      errorMap: () => ({ message: 'Invalid lead status.' }),
    }).optional(),
    source: z.string().optional().nullable(),
    data: jsonSchema.optional().nullable(),
  }).partial();

// You can also export the inferred types if you prefer not to maintain separate interface files.
// export type CreateLeadDto = z.infer<typeof createLeadSchema>;
// export type UpdateLeadDto = z.infer<typeof updateLeadSchema>;
