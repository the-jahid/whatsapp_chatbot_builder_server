// src/agent-modules/lead-custom-field-intake/dto/create-lead-custom-field-intake.dto.ts
import { z } from 'zod';
import { CreateLeadCustomFieldIntakeSchema } from '../schema/lead-custom-field-intake.schema';

// Body for: POST /outbound-campaigns/:campaignId/custom-fields
export type CreateLeadCustomFieldIntakeDto = z.infer<typeof CreateLeadCustomFieldIntakeSchema>;
export { CreateLeadCustomFieldIntakeSchema };
























