import { z } from 'zod';

/**
 * Common field validators
 */
const NonEmptyTrimmed = z.string().trim().min(1, 'Required');
const NameSchema = NonEmptyTrimmed.max(120, 'Max 120 characters');
const DescriptionSchema = z.string().trim().max(1000, 'Max 1000 characters').optional();
const UUID = () => z.string().uuid('Invalid UUID');

/**
 * 1) Base object (matches Prisma model shape)
 * - Use this for entity-level validation/typing if needed.
 */
export const appointmentLeadItemBaseSchema = z.object({
  id: UUID().optional(),
  name: NameSchema,
  description: DescriptionSchema,
  agentId: UUID(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
}).strict();

/**
 * 2) Create payload (POST)
 * - Caller must provide agentId + name
 * - description is optional
 */
export const createAppointmentLeadItemSchema = appointmentLeadItemBaseSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * 3) Update payload (PATCH)
 * - Only allow updating mutable fields (name/description)
 * - Do NOT allow changing agentId via update
 */
export const updateAppointmentLeadItemSchema = z.object({
  name: NameSchema.optional(),
  description: DescriptionSchema,
}).strict();

/**
 * 4) Query (GET list)
 * - Filter by agentId (required)
 * - Optional search on name/description
 * - Cursor pagination
 */
export const queryAppointmentLeadItemsSchema = z.object({
  agentId: UUID(),
  search: z.string().trim().min(1).max(120).optional(),
  cursor: UUID().optional(),       // pass last item id
  take: z.number().int().positive().max(100).optional(), // default in controller/service
}).strict();

/**
 * 5) Path params schemas
 */
export const idParamSchema = z.object({ id: UUID() }).strict();
export const agentIdParamSchema = z.object({ agentId: UUID() }).strict();

/**
 * 6) Types
 */
export type AppointmentLeadItem = z.infer<typeof appointmentLeadItemBaseSchema>;
export type CreateAppointmentLeadItemInput = z.infer<typeof createAppointmentLeadItemSchema>;
export type UpdateAppointmentLeadItemInput = z.infer<typeof updateAppointmentLeadItemSchema>;
export type QueryAppointmentLeadItemsInput = z.infer<typeof queryAppointmentLeadItemsSchema>;
