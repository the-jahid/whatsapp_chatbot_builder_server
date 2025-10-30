import { z } from 'zod';
import { upsertWeeklyAvailabilitySchema } from '../schema/weekly_availability.schema';

export type UpsertWeeklyAvailabilityDto = z.infer<typeof upsertWeeklyAvailabilitySchema>;
