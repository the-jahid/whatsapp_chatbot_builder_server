import { z } from 'zod';
import { deleteWeeklyAvailabilitySchema } from '../schema/weekly_availability.schema';

export type DeleteWeeklyAvailabilityDto = z.infer<typeof deleteWeeklyAvailabilitySchema>;
