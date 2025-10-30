import { z } from 'zod';
import { UpsertCustomFieldsSchema } from '../schema/outbound-lead.schema';

export type UpsertCustomFieldsDto = z.infer<typeof UpsertCustomFieldsSchema>;
export { UpsertCustomFieldsSchema };
