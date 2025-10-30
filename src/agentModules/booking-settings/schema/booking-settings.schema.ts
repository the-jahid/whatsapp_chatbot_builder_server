import { z } from 'zod';

/** IANA timezone validator (e.g., "Europe/Rome") */
const isValidIanaTz = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const IanaTimezoneSchema = z
  .string()
  .min(1)
  .refine(isValidIanaTz, { message: 'Invalid IANA timezone (e.g., "Europe/Rome")' });

/** 1) Base object (plain ZodObject — supports omit/partial/strict) */
export const bookingSettingsBaseSchema = z.object({
  id: z.string().uuid().optional(),
  appointmentSlot: z.number().int().min(5).max(120).refine(v => v % 5 === 0, {
    message: 'Slot must be multiple of 5 minutes',
  }),
  allowSameDayBooking: z.boolean(),
  enableNotifications: z.boolean(),
  notificationEmails: z
    .array(z.string().email('Invalid email'))
    .max(5, 'Max 5 emails')
    .default([]),

  /** NEW: default display/availability timezone (IANA) */
  timezone: IanaTimezoneSchema.default('UTC'),

  agentId: z.string().uuid().optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

/** 2) Full model with cross-field rule (returns ZodEffects – no omit here) */
export const bookingSettingsSchema = bookingSettingsBaseSchema.superRefine((d, ctx) => {
  if (d.enableNotifications && (!d.notificationEmails || d.notificationEmails.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['notificationEmails'],
      message: 'Provide at least one email when notifications are enabled',
    });
  }
});

/** 3) PUT payload (derive from base BEFORE refine) */
export const upsertBookingSettingsSchema = bookingSettingsBaseSchema.omit({
  id: true,
  agentId: true,
  createdAt: true,
  updatedAt: true,
});

/** 4) PATCH payload (partial + strict), add the rule again if needed */
export const patchBookingSettingsSchema = upsertBookingSettingsSchema
  .partial()
  .strict()
  .superRefine((d, ctx) => {
    if (d.enableNotifications === true && (!d.notificationEmails || d.notificationEmails.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['notificationEmails'],
        message: 'Provide at least one email when notifications are enabled',
      });
    }
    if (d.timezone !== undefined && !isValidIanaTz(d.timezone)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['timezone'],
        message: 'Invalid IANA timezone (e.g., "Europe/Rome")',
      });
    }
  });

/** Types */
export type BookingSettings = z.infer<typeof bookingSettingsSchema>;
export type UpsertBookingSettingsInput = z.infer<typeof upsertBookingSettingsSchema>;
export type PatchBookingSettingsInput = z.infer<typeof patchBookingSettingsSchema>;
