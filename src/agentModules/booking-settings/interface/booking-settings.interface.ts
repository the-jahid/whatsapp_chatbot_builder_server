import { z } from 'zod';
import { bookingSettingsSchema } from '../schema/booking-settings.schema';

/** External-facing Booking Settings shape (safe for API responses) */
export interface IBookingSettings {
  id?: string;
  appointmentSlot: number;          // minutes
  allowSameDayBooking: boolean;
  enableNotifications: boolean;
  notificationEmails: string[];     // 0–5 emails
  agentId?: string;                 // usually implied by route
  createdAt?: Date;
  updatedAt?: Date;
}

/** Zod-inferred type (stays 1:1 with schema) */
export type BookingSettings = z.infer<typeof bookingSettingsSchema>;
