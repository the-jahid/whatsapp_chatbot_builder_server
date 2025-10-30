// src/modules/outbound-broadcast/outbound-broadcast.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { OutboundBroadcastService } from './outbound-broadcast.service';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';

/** Simple pipe to avoid empty/whitespace IDs (we accept ANY non-empty string). */
class NonEmptyStringParam {
  static parse(value: string, name: string): string {
    const v = (value ?? '').trim();
    if (!v) throw new BadRequestException(`Param "${name}" is required`);
    return v;
  }
}

@UseGuards(ClerkAuthGuard)
@Controller('outbound-broadcast')
export class OutboundBroadcastController {
  constructor(private readonly svc: OutboundBroadcastService) {}

  /* -------------------------------------------------------
   * Health / smoke test (handy in Postman)
   * -----------------------------------------------------*/
  @Get('health')
  @HttpCode(200)
  health() {
    return { ok: true, service: 'outbound-broadcast' };
  }

  /* -------------------------------------------------------
   * Core actions
   * -----------------------------------------------------*/

  /**
   * Start/enable a campaign's broadcast.
   * - Ensures Broadcast row exists and sets it to RUNNING (isEnabled=true, isPaused=false)
   * - Sets the campaign to RUNNING
   * - Performs one immediate batch using Broadcast throttling config
   */
  @Post('agents/:agentId/campaigns/:campaignId/start')
  @HttpCode(201)
  async startCampaign(
    @Param('agentId') agentIdRaw: string,
    @Param('campaignId') campaignIdRaw: string,
  ) {
    const agentId = NonEmptyStringParam.parse(agentIdRaw, 'agentId');
    const campaignId = NonEmptyStringParam.parse(campaignIdRaw, 'campaignId');
    return this.svc.startCampaign(agentId, campaignId);
  }

  /**
   * Pause a campaign's broadcast.
   * (OutboundCampaignStatus has no "PAUSED", so service maps this to SCHEDULED.)
   */
  @Post('agents/:agentId/campaigns/:campaignId/pause')
  @HttpCode(200)
  async pauseCampaign(
    @Param('agentId') agentIdRaw: string,
    @Param('campaignId') campaignIdRaw: string,
  ) {
    const agentId = NonEmptyStringParam.parse(agentIdRaw, 'agentId');
    const campaignId = NonEmptyStringParam.parse(campaignIdRaw, 'campaignId');
    return this.svc.pauseCampaign(agentId, campaignId);
  }

  /**
   * Resume a campaign's broadcast.
   * If startAt is in the future -> READY/SCHEDULED; otherwise RUNNING and runs a pass.
   */
  @Post('agents/:agentId/campaigns/:campaignId/resume')
  @HttpCode(200)
  async resumeCampaign(
    @Param('agentId') agentIdRaw: string,
    @Param('campaignId') campaignIdRaw: string,
  ) {
    const agentId = NonEmptyStringParam.parse(agentIdRaw, 'agentId');
    const campaignId = NonEmptyStringParam.parse(campaignIdRaw, 'campaignId');
    return this.svc.resumeCampaign(agentId, campaignId);
  }

  /**
   * Update broadcast settings for a campaign.
   * Accepts partial settings object; service validates with zod and applies transitions.
   */
  @Patch('agents/:agentId/campaigns/:campaignId/settings')
  @HttpCode(200)
  async updateSettings(
    @Param('agentId') agentIdRaw: string,
    @Param('campaignId') campaignIdRaw: string,
    @Body() body: unknown,
  ) {
    const agentId = NonEmptyStringParam.parse(agentIdRaw, 'agentId');
    const campaignId = NonEmptyStringParam.parse(campaignIdRaw, 'campaignId');
    return this.svc.updateBroadcastSettings(agentId, campaignId, body);
  }

  /**
   * Quick helper to set/clear the selected template for a campaign's broadcast.
   * Useful for the Leads page "template picker".
   */
  @Put('agents/:agentId/campaigns/:campaignId/template/:templateId')
  @HttpCode(200)
  async setTemplate(
    @Param('agentId') agentIdRaw: string,
    @Param('campaignId') campaignIdRaw: string,
    @Param('templateId') templateIdRaw: string,
  ) {
    const agentId = NonEmptyStringParam.parse(agentIdRaw, 'agentId');
    const campaignId = NonEmptyStringParam.parse(campaignIdRaw, 'campaignId');
    const templateId = NonEmptyStringParam.parse(templateIdRaw, 'templateId');

    // Service checks ownership & existence of template
    return this.svc.updateBroadcastSettings(agentId, campaignId, {
      selectedTemplateId: templateId,
    });
  }

  @Delete('agents/:agentId/campaigns/:campaignId/template')
  @HttpCode(200)
  async clearTemplate(
    @Param('agentId') agentIdRaw: string,
    @Param('campaignId') campaignIdRaw: string,
  ) {
    const agentId = NonEmptyStringParam.parse(agentIdRaw, 'agentId');
    const campaignId = NonEmptyStringParam.parse(campaignIdRaw, 'campaignId');

    return this.svc.updateBroadcastSettings(agentId, campaignId, {
      selectedTemplateId: null,
    });
  }

  /**
   * Get campaign + broadcast status and counters.
   */
  @Get('campaigns/:campaignId/status')
  @HttpCode(200)
  async getStatus(@Param('campaignId') campaignIdRaw: string) {
    const campaignId = NonEmptyStringParam.parse(campaignIdRaw, 'campaignId');
    return this.svc.getCampaignStatus(campaignId);
  }

  /**
   * Convenience alias of "status" that also verifies the agentId in the path.
   */
  @Get('agents/:agentId/campaigns/:campaignId')
  @HttpCode(200)
  async getCampaignOverview(
    @Param('agentId') agentIdRaw: string,
    @Param('campaignId') campaignIdRaw: string,
  ) {
    const agentId = NonEmptyStringParam.parse(agentIdRaw, 'agentId');
    const campaignId = NonEmptyStringParam.parse(campaignIdRaw, 'campaignId');
    // Ownership is enforced inside service APIs that mutate; read is safe here.
    // If you want to enforce ownership on read too, call a small assertion here.
    return this.svc.getCampaignStatus(campaignId);
  }

  /**
   * (Optional) Manually trigger the cron logic once.
   * Handy for Postman testing without waiting for the scheduler tick.
   */
  @Post('cron/run-once')
  @HttpCode(202)
  async runCronOnce() {
    await this.svc.cronRunner();
    return { ok: true };
  }
}
