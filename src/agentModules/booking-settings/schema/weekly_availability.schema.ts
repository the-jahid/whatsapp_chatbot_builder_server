import { z } from 'zod';
import { DayOfWeek } from '@prisma/client';

/** One availability window */
export const weeklyAvailabilityWindowSchema = z.object({
  dayOfWeek: z.nativeEnum(DayOfWeek),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM (24h)'),
  endTime:   z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM (24h)'),
}).refine(({ startTime, endTime }) => {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  return eh * 60 + em > sh * 60 + sm;
}, { message: 'endTime must be after startTime' });

/** Base row schema (mirrors Prisma.WeeklyAvailability) */
export const weeklyAvailabilitySchema = z.object({
  id: z.string().uuid().optional(),
  dayOfWeek: z.nativeEnum(DayOfWeek),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  agentId: z.string().uuid().optional(),
});

/** PUT semantics: replace full set for an agent */
export const upsertWeeklyAvailabilitySchema = z.object({
  windows: z.array(weeklyAvailabilityWindowSchema).min(1),
});

/** DELETE semantics: delete all, by day, or by range */
export const deleteWeeklyAvailabilitySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }),
  z.object({
    mode: z.literal('byDay'),
    dayOfWeek: z.nativeEnum(DayOfWeek),
  }),
  z.object({
    mode: z.literal('byRange'),
    dayOfWeek: z.nativeEnum(DayOfWeek),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
  }),
]);

/** Types */
export type WeeklyAvailability = z.infer<typeof weeklyAvailabilitySchema>;
export type UpsertWeeklyAvailabilityInput = z.infer<typeof upsertWeeklyAvailabilitySchema>;
export type DeleteWeeklyAvailabilityInput = z.infer<typeof deleteWeeklyAvailabilitySchema>;
