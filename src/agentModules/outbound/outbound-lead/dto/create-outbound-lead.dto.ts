import { z } from 'zod';
import { CreateOutboundLeadSchema } from '../schema/outbound-lead.schema';

export type CreateOutboundLeadDto = z.infer<typeof CreateOutboundLeadSchema>;
export { CreateOutboundLeadSchema };
