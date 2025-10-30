import { z } from 'zod';
import { OutboundLeadStatus } from '@prisma/client';
import { UUID_ANY } from './outbound-lead.schema';

const StatusOneOrMany = z
  .union([
    z.nativeEnum(OutboundLeadStatus),
    z.array(z.nativeEnum(OutboundLeadStatus)).nonempty(),
  ])
  .optional();

export const QueryOutboundLeadsSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20).optional(),

    // usually from path; keep here if you ever allow filtering across campaigns
    outboundCampaignId: UUID_ANY.optional(),

    status: StatusOneOrMany,
    q: z.string().trim().min(1).max(120).optional(), // search phoneNumber / firstName

    createdFrom: z.coerce.date().optional(),
    createdTo: z.coerce.date().optional(),
    lastAttemptFrom: z.coerce.date().optional(),
    lastAttemptTo: z.coerce.date().optional(),

    sortBy: z
      .enum(['createdAt', 'lastAttemptAt', 'status', 'phoneNumber', 'firstName'])
      .default('createdAt')
      .optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc').optional(),
  })
  .refine(
    (d) => !(d.createdFrom && d.createdTo) || d.createdFrom <= d.createdTo,
    { message: 'createdFrom must be <= createdTo', path: ['createdFrom'] },
  )
  .refine(
    (d) => !(d.lastAttemptFrom && d.lastAttemptTo) || d.lastAttemptFrom <= d.lastAttemptTo,
    { message: 'lastAttemptFrom must be <= lastAttemptTo', path: ['lastAttemptFrom'] },
  );

export type QueryOutboundLeadsInput = z.infer<typeof QueryOutboundLeadsSchema>;
