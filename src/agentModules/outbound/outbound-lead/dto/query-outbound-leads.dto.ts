import { z } from 'zod';
import { QueryOutboundLeadsSchema } from '../schema/query-outbound-leads.schema';

export type QueryOutboundLeadsDto = z.infer<typeof QueryOutboundLeadsSchema>;
export { QueryOutboundLeadsSchema };
