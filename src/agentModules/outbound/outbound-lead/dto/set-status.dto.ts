import { z } from 'zod';
import { SetLeadStatusSchema } from '../schema/outbound-lead.schema';

export type SetLeadStatusDto = z.infer<typeof SetLeadStatusSchema>;
export { SetLeadStatusSchema };
