import { z } from 'zod';
// Import the enum from the generated Prisma client for use in the interface.
import { CalendarProvider } from '@prisma/client';
import { calendarConnectionSchema } from '../schema/calendar-connection.schema';


/**
 * Zod schema for the EXTERNAL representation of a CalendarConnection.
 * It is derived from the base schema but omits sensitive fields that should
 * never be exposed to a client-side application.
 */
export const externalCalendarConnectionSchema = calendarConnectionSchema.omit({
  accessToken: true,
  refreshToken: true,
});

/**
 * Defines the TypeScript interface for an external-facing CalendarConnection object.
 * This provides a classic interface definition for the data shape.
 */
export interface IExternalCalendarConnection {
  id: string;
  provider: CalendarProvider;
  accountEmail: string;
  accessTokenExpiresAt: Date | null;
  calendarId: string | null;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
}

/**
 * Defines the TypeScript type for an external-facing CalendarConnection object using Zod's `infer`.
 * This is the recommended approach as it automatically stays in sync with the Zod schema.
 * This type is functionally identical to the IExternalCalendarConnection interface above.
 */
export type ExternalCalendarConnection = z.infer<
  typeof externalCalendarConnectionSchema
>;
