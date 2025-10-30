// src/agent-modules/outbound-campaign/outbound-campaign.module.ts
import { Module } from '@nestjs/common';

import { OutboundCampaignController } from './outbound-campaign.controller';
import { OutboundCampaignService } from './outbound-campaign.service';
import { OutboundCampaignRepository } from './repository/outbound-campaign.repository';

// If you already have a PrismaModule, import it instead of providing PrismaService directly.
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  imports: [],
  controllers: [OutboundCampaignController],
  providers: [OutboundCampaignService, OutboundCampaignRepository, PrismaService],
  exports: [OutboundCampaignService, OutboundCampaignRepository],
})
export class OutboundCampaignModule {}


