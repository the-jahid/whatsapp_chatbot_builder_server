import { z } from 'zod';
import { createCalendarConnectionSchema, updateCalendarConnectionSchema } from '../schema/calendar-connection.schema';
// Adjust path if necessary

/**
 * The DTO for creating a calendar connection.
 * Its type is inferred directly from the createCalendarConnectionSchema using Zod.
 * This ensures the type always matches the validation logic.
 */
export type CreateCalendarConnectionDto = z.infer<
  typeof createCalendarConnectionSchema
>;

/**
 * The DTO for updating a calendar connection.
 * Its type is inferred directly from the updateCalendarConnectionSchema using Zod.
 * This ensures the type always matches the validation logic for partial updates.
 */
export type UpdateCalendarConnectionDto = z.infer<
  typeof updateCalendarConnectionSchema
>;



