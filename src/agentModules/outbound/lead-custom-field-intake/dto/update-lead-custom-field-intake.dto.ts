// src/agent-modules/lead-custom-field-intake/dto/update-lead-custom-field-intake.dto.ts
import { z } from 'zod';
import { UpdateLeadCustomFieldIntakeSchema } from '../schema/lead-custom-field-intake.schema';

// Body for: PATCH /custom-fields/:id
export type UpdateLeadCustomFieldIntakeDto = z.infer<typeof UpdateLeadCustomFieldIntakeSchema>;
export { UpdateLeadCustomFieldIntakeSchema };
