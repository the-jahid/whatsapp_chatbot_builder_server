// src/agent-modules/outbound-campaign/schema/outbound-campaign.schema.ts
import { z } from 'zod';
import { OutboundCampaignStatus } from '@prisma/client';

// Accept ANY UUID version, trimmed
export const UUID_ANY = z
  .string()
  .trim()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    'Invalid UUID',
  );

export const Name = z.string().trim().min(2, 'name is too short').max(200, 'name is too long');

export const CreateOutboundCampaignSchema = z.object({
  agentId: UUID_ANY,
  name: Name,
  status: z.nativeEnum(OutboundCampaignStatus).default(OutboundCampaignStatus.DRAFT).optional(),
});

export const UpdateOutboundCampaignSchema = z.object({
  name: Name.optional(),
  status: z.nativeEnum(OutboundCampaignStatus).optional(),
});

export const SetStatusSchema = z.object({
  id: UUID_ANY,
  status: z.nativeEnum(OutboundCampaignStatus),
});

export const QueryOutboundCampaignsSchema = z.object({
  agentId: UUID_ANY,
  status: z.nativeEnum(OutboundCampaignStatus).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'name', 'status']).default('createdAt').optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc').optional(),
});

export type CreateOutboundCampaignInput = z.infer<typeof CreateOutboundCampaignSchema>;
export type UpdateOutboundCampaignInput = z.infer<typeof UpdateOutboundCampaignSchema>;
export type QueryOutboundCampaignsInput = z.infer<typeof QueryOutboundCampaignsSchema>;
