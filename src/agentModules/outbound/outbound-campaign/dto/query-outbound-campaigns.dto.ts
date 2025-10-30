// src/agent-modules/outbound-campaign/dto/query-outbound-campaigns.dto.ts
import { z } from 'zod';
import { QueryOutboundCampaignsSchema } from '../schema';


export type QueryOutboundCampaignsDto = z.infer<typeof QueryOutboundCampaignsSchema>;
