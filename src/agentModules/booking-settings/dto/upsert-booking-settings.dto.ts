import { z } from 'zod';
import { upsertBookingSettingsSchema } from '../schema/booking-settings.schema';

export type UpsertBookingSettingsDto = z.infer<typeof upsertBookingSettingsSchema>;
