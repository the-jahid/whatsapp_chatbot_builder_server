import { z } from 'zod';
import { UpdateOutboundLeadSchema } from '../schema/outbound-lead.schema';

export type UpdateOutboundLeadDto = z.infer<typeof UpdateOutboundLeadSchema>;
export { UpdateOutboundLeadSchema };
