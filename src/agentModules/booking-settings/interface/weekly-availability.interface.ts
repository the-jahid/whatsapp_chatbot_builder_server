import { z } from 'zod';
import { DayOfWeek } from '@prisma/client';
import {
  weeklyAvailabilitySchema,
  weeklyAvailabilityWindowSchema,
  upsertWeeklyAvailabilitySchema,
  deleteWeeklyAvailabilitySchema,
} from '../schema/weekly_availability.schema';

/** One availability window for a weekday */
export interface IWeeklyAvailabilityWindow {
  dayOfWeek: DayOfWeek;
  startTime: string;   // "HH:MM" 24h
  endTime: string;     // "HH:MM" 24h
}

/** DB row-like shape (when reading existing rows) */
export interface IWeeklyAvailability extends IWeeklyAvailabilityWindow {
  id?: string;
  agentId?: string;
}

/** Zod-inferred types to keep parity with schemas */
export type WeeklyAvailability = z.infer<typeof weeklyAvailabilitySchema>;
export type WeeklyAvailabilityWindow = z.infer<typeof weeklyAvailabilityWindowSchema>;
export type UpsertWeeklyAvailabilityInput = z.infer<typeof upsertWeeklyAvailabilitySchema>;
export type DeleteWeeklyAvailabilityInput = z.infer<typeof deleteWeeklyAvailabilitySchema>;
