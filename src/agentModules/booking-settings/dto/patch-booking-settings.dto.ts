import { z } from 'zod';
import { patchBookingSettingsSchema } from '../schema/booking-settings.schema';

export type PatchBookingSettingsDto = z.infer<typeof patchBookingSettingsSchema>;
