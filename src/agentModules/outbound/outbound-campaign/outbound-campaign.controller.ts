// src/agent-modules/outbound-campaign/outbound-campaign.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { OutboundCampaignStatus } from '@prisma/client';

import { OutboundCampaignService } from './outbound-campaign.service';

import type {
  OutboundCampaignEntity,
  OutboundCampaignQuery,
  PaginatedResult,
} from './interface';
import type {
  CreateOutboundCampaignDto,
  UpdateOutboundCampaignDto,
  QueryOutboundCampaignsDto,
} from './dto';

import {
  CreateOutboundCampaignSchema,
  UpdateOutboundCampaignSchema,
  QueryOutboundCampaignsSchema,
  UUID_ANY,
} from './schema';
import { ZodValidationPipe } from 'src/common/pipes/zod.validation.pipe';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';



/** Body-only schema for the status endpoint (id comes from route param) */
const SetStatusBodySchema = z.object({
  status: z.nativeEnum(OutboundCampaignStatus),
});
type SetStatusBody = z.infer<typeof SetStatusBodySchema>;

/**
 * REST controller for OutboundCampaign.
 * - Validates params/query/body with Zod at the edge via your ZodValidationPipe
 * - Returns plain resources (201/200) and 204 on delete
 * - Errors (400/404/500) bubble from service as HttpExceptions
 */
@UseGuards(ClerkAuthGuard)
@Controller('outbound-campaigns')
export class OutboundCampaignController {
  constructor(private readonly service: OutboundCampaignService) {}

  /**
   * Create campaign
   * POST /outbound-campaigns
   * 201 -> OutboundCampaignEntity
   */
  @Post()
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(CreateOutboundCampaignSchema))
    body: CreateOutboundCampaignDto,
  ): Promise<OutboundCampaignEntity> {
    return this.service.create(body);
  }

  /**
   * List campaigns (paginated + filters)
   * GET /outbound-campaigns?agentId=...&status=...&search=...&page=1&limit=20&sortBy=createdAt&sortOrder=desc
   * 200 -> { items, page, limit, total, hasNextPage }
   */
  @Get()
  @HttpCode(200)
  async list(
    @Query(new ZodValidationPipe(QueryOutboundCampaignsSchema))
    query: QueryOutboundCampaignsDto,
  ): Promise<PaginatedResult<OutboundCampaignEntity>> {
    return this.service.list(query as unknown as OutboundCampaignQuery);
  }

  /**
   * Get single campaign
   * GET /outbound-campaigns/:id?agentId=...
   * 200 -> OutboundCampaignEntity
   */
  @Get(':id')
  @HttpCode(200)
  async getById(
    @Param('id', new ZodValidationPipe(UUID_ANY)) id: string,
    @Query('agentId', new ZodValidationPipe(UUID_ANY.optional()))
    agentId?: string,
  ): Promise<OutboundCampaignEntity> {
    return this.service.getById(id, agentId);
  }

  /**
   * Update (partial)
   * PATCH /outbound-campaigns/:id?agentId=...
   * 200 -> OutboundCampaignEntity
   */
  @Patch(':id')
  @HttpCode(200)
  async update(
    @Param('id', new ZodValidationPipe(UUID_ANY)) id: string,
    @Body(new ZodValidationPipe(UpdateOutboundCampaignSchema))
    body: UpdateOutboundCampaignDto,
    @Query('agentId', new ZodValidationPipe(UUID_ANY.optional()))
    agentId?: string,
  ): Promise<OutboundCampaignEntity> {
    return this.service.update(id, body, { agentId });
  }

  /**
   * Set status only
   * PATCH /outbound-campaigns/:id/status?agentId=...
   * 200 -> OutboundCampaignEntity
   */
  @Patch(':id/status')
  @HttpCode(200)
  async setStatus(
    @Param('id', new ZodValidationPipe(UUID_ANY)) id: string,
    @Body(new ZodValidationPipe(SetStatusBodySchema))
    body: SetStatusBody,
    @Query('agentId', new ZodValidationPipe(UUID_ANY.optional()))
    agentId?: string,
  ): Promise<OutboundCampaignEntity> {
    return this.service.setStatus(id, body, { agentId });
  }

  /**
   * Delete campaign
   * DELETE /outbound-campaigns/:id?agentId=...
   * 204 No Content
   */
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', new ZodValidationPipe(UUID_ANY)) id: string,
    @Query('agentId', new ZodValidationPipe(UUID_ANY.optional()))
    agentId?: string,
  ): Promise<void> {
    await this.service.remove(id, { agentId });
  }
}
