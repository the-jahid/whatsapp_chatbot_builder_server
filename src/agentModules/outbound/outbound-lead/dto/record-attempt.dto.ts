import { z } from 'zod';
import { RecordAttemptSchema } from '../schema/outbound-lead.schema';

export type RecordAttemptDto = z.infer<typeof RecordAttemptSchema>;
export { RecordAttemptSchema };
