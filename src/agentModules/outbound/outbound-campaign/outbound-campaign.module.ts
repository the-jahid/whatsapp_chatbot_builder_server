// src/agent-modules/outbound-campaign/outbound-campaign.module.ts
import { Module } from '@nestjs/common';

import { OutboundCampaignController } from './outbound-campaign.controller';
import { OutboundCampaignService } from './outbound-campaign.service';
import { OutboundCampaignRepository } from './repository/outbound-campaign.repository';

//

@Module({
  imports: [],
  controllers: [OutboundCampaignController],
  providers: [OutboundCampaignService, OutboundCampaignRepository],
  exports: [OutboundCampaignService, OutboundCampaignRepository],
})
export class OutboundCampaignModule {}


