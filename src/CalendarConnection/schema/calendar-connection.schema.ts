import { z } from 'zod';
// Import the enum from the generated Prisma client to ensure they match.
import { CalendarProvider } from '@prisma/client';

/**
 * Base Zod schema for the CalendarConnection model.
 * This defines the shape and types for all fields, mirroring the Prisma schema.
 * It serves as the single source of truth for validation logic.
 */
export const calendarConnectionSchema = z.object({
  id: z.string().uuid(),
  provider: z.nativeEnum(CalendarProvider),
  accountEmail: z.string().email({ message: 'Invalid email address' }),
  accessToken: z.string().optional().nullable(),
  refreshToken: z.string().optional().nullable(),
  accessTokenExpiresAt: z.date().optional().nullable(),
  calendarId: z.string().optional().nullable(),
  isPrimary: z.boolean().default(false),
  createdAt: z.date(),
  updatedAt: z.date(),
  userId: z.string().uuid(),
});

/**
 * Zod schema for validating the payload when CREATING a new CalendarConnection.
 * It omits database-generated fields like `id`, `createdAt`, and `updatedAt`.
 * It makes fields that are required on creation non-optional.
 */
export const createCalendarConnectionSchema = calendarConnectionSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  // Make refreshToken required during creation, as it's essential.
  refreshToken: z.string({ required_error: 'Refresh token is required' }),
});

/**
 * Zod schema for validating the payload when UPDATING an existing CalendarConnection.
 * It makes all fields optional, allowing for partial updates (e.g., via a PATCH request).
 * You can pick which fields you want to allow for updates.
 */
export const updateCalendarConnectionSchema = z.object({
  isPrimary: z.boolean().optional(),
  calendarId: z.string().optional(),
});

// You can also export the inferred TypeScript types for use in your services and controllers.
export type CalendarConnection = z.infer<typeof calendarConnectionSchema>;
export type CreateCalendarConnectionInput = z.infer<typeof createCalendarConnectionSchema>;
export type UpdateCalendarConnectionInput = z.infer<typeof updateCalendarConnectionSchema>;
