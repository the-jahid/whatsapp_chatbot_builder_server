// src/agent-modules/outbound-campaign/dto/create-outbound-campaign.dto.ts
import { z } from 'zod';
import { CreateOutboundCampaignSchema } from '../schema';

export type CreateOutboundCampaignDto = z.infer<typeof CreateOutboundCampaignSchema>;
