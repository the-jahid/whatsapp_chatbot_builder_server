// src/agent-modules/lead-custom-field-intake/dto/query-lead-custom-field-intakes.dto.ts
import { z } from 'zod';
import { QueryLeadCustomFieldIntakesSchema } from '../schema/query-lead-custom-field-intakes.schema';

// Query for: GET /outbound-campaigns/:campaignId/custom-fields
export type QueryLeadCustomFieldIntakesDto = z.infer<typeof QueryLeadCustomFieldIntakesSchema>;
export { QueryLeadCustomFieldIntakesSchema };


