// src/agent-modules/lead-custom-field-intake/schema/lead-custom-field-intake.schema.ts
import { z } from 'zod';

// Accept ANY UUID version; trim first, then regex on the string itself
const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const UUID_ANY = z
  .string()
  .trim()
  .regex(UUID_REGEX, 'Invalid UUID');

/**
 * Machine-safe key (e.g., "referenceId").
 * Starts with a letter, then letters/numbers/_ only.
 */
export const MachineName = z
  .string()
  .trim()
  .min(1, 'name is required')
  .max(64, 'max 64 characters')
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'use letters/numbers/underscore; must start with a letter');

// ---------- Body Schemas ----------

// POST /outbound-campaigns/:campaignId/custom-fields
export const CreateLeadCustomFieldIntakeSchema = z.object({
  name: MachineName,
});
export type CreateLeadCustomFieldIntakeInput = z.infer<typeof CreateLeadCustomFieldIntakeSchema>;

// PATCH /custom-fields/:id
export const UpdateLeadCustomFieldIntakeSchema = z.object({
  name: MachineName.optional(),
});
export type UpdateLeadCustomFieldIntakeInput = z.infer<typeof UpdateLeadCustomFieldIntakeSchema>;

// ---------- Param Schemas (optional) ----------

export const CampaignIdParamSchema = z.object({
  campaignId: UUID_ANY,
});
export type CampaignIdParam = z.infer<typeof CampaignIdParamSchema>;

export const CustomFieldIdParamSchema = z.object({
  id: UUID_ANY,
});
export type CustomFieldIdParam = z.infer<typeof CustomFieldIdParamSchema>;
