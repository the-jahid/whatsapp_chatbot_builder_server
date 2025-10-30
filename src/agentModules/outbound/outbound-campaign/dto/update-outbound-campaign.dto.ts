// src/agent-modules/outbound-campaign/dto/update-outbound-campaign.dto.ts
import { z } from 'zod';
import { UpdateOutboundCampaignSchema } from '../schema';


export type UpdateOutboundCampaignDto = z.infer<typeof UpdateOutboundCampaignSchema>;
