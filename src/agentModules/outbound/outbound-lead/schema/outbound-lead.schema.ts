import { z } from 'zod';
import { OutboundLeadStatus } from '@prisma/client';

// Accept ANY UUID version, trim before checking
export const UUID_ANY = z
  .string()
  .trim()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    'Invalid UUID',
  );

// E.164-ish phone number (simple, lenient)
export const Phone = z
  .string()
  .trim()
  .min(6, 'phoneNumber is too short')
  .max(20, 'phoneNumber is too long')
  .regex(/^\+?[0-9]{6,20}$/, 'phoneNumber must be digits with optional leading +');

export const FirstName = z.string().trim().min(1).max(120);

// ---------- Body Schemas ----------

// POST /outbound-campaigns/:campaignId/leads
// (campaignId comes from path)
export const CreateOutboundLeadSchema = z.object({
  phoneNumber: Phone,
  firstName: FirstName,
  timeZone: z.string().trim().min(1).max(64).default('UTC').optional(),
  status: z.nativeEnum(OutboundLeadStatus).default(OutboundLeadStatus.QUEUED).optional(),
  maxAttempts: z.coerce.number().int().min(1).max(10).default(3).optional(),
  customFields: z.any().optional(), // JSONB
});
export type CreateOutboundLeadInput = z.infer<typeof CreateOutboundLeadSchema>;

// PATCH /leads/:id
export const UpdateOutboundLeadSchema = z.object({
  phoneNumber: Phone.optional(),
  firstName: FirstName.optional(),
  timeZone: z.string().trim().min(1).max(64).optional(),
  status: z.nativeEnum(OutboundLeadStatus).optional(),
  maxAttempts: z.coerce.number().int().min(1).max(10).optional(),
  customFields: z.any().optional(), // replace whole JSON (use upsert schema below for merge)
});
export type UpdateOutboundLeadInput = z.infer<typeof UpdateOutboundLeadSchema>;

// PATCH /leads/:id/status
export const SetLeadStatusSchema = z.object({
  status: z.nativeEnum(OutboundLeadStatus),
});
export type SetLeadStatusInput = z.infer<typeof SetLeadStatusSchema>;

// PATCH /leads/:id/record-attempt
export const RecordAttemptSchema = z.object({
  attemptsIncrement: z.coerce.number().int().min(1).max(10).default(1).optional(),
  lastAttemptAt: z.coerce.date().optional(), // if omitted, service can set now()
});
export type RecordAttemptInput = z.infer<typeof RecordAttemptSchema>;

// PATCH /leads/:id/custom-fields
export const UpsertCustomFieldsSchema = z.object({
  mode: z.enum(['merge', 'replace']).default('merge').optional(),
  data: z.any(), // object to merge/replace into JSONB
});
export type UpsertCustomFieldsInput = z.infer<typeof UpsertCustomFieldsSchema>;

// ---------- Param Schemas (optional if you validate in pipes) ----------

export const CampaignIdParamSchema = z.object({ campaignId: UUID_ANY });
export type CampaignIdParam = z.infer<typeof CampaignIdParamSchema>;

export const LeadIdParamSchema = z.object({ id: UUID_ANY });
export type LeadIdParam = z.infer<typeof LeadIdParamSchema>;
