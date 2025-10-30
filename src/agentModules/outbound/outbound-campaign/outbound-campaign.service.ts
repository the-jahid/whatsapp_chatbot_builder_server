// src/agent-modules/outbound-campaign/outbound-campaign.service.ts
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OutboundCampaignStatus, PrismaClient } from '@prisma/client';
import { ZodError } from 'zod';

import {
  CreateOutboundCampaignSchema,
  UpdateOutboundCampaignSchema,
  QueryOutboundCampaignsSchema,
  SetStatusSchema,
  UUID_ANY,
} from './schema';
import type {
  OutboundCampaignEntity,
  OutboundCampaignQuery,
  PaginatedResult,
} from './interface';
import { OutboundCampaignRepository } from './repository/outbound-campaign.repository';

// Prisma error type import (supported on recent Prisma versions)
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

@Injectable()
export class OutboundCampaignService {
  private readonly logger = new Logger(OutboundCampaignService.name);

  constructor(private readonly repo: OutboundCampaignRepository) {}

  /* ----------------------------- Helpers ----------------------------- */

  private formatZod(err: ZodError): string {
    return err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  }

  private assertId(id: string): string {
    const parsed = UUID_ANY.safeParse(id);
    if (!parsed.success) {
      throw new BadRequestException(this.formatZod(parsed.error));
    }
    return parsed.data;
  }

  private ensureOwnership(entity: OutboundCampaignEntity | null, agentId?: string) {
    if (!entity) throw new NotFoundException('Campaign not found');
    if (agentId && entity.agentId !== agentId) {
      // Don’t leak existence across tenants
      throw new NotFoundException('Campaign not found');
    }
  }

  private handlePrisma(e: unknown): never {
    if (e instanceof PrismaClientKnownRequestError) {
      // Record not found
      if (e.code === 'P2025') {
        throw new NotFoundException('Campaign not found');
      }
      // FK violation (e.g., agentId not existing)
      if (e.code === 'P2003') {
        throw new BadRequestException('Invalid relationship reference (e.g., agentId)');
      }
      // Unique constraint (future-proof)
      if (e.code === 'P2002') {
        throw new BadRequestException('Unique constraint failed');
      }
    }
    throw e;
  }

  /**
   * Best-effort helper: ensure a Broadcast row exists for a campaign.
   * Uses Prisma defaults from your schema. Any error is logged but not rethrown
   * so other endpoints/flows remain unaffected.
   */
  private async ensureDefaultBroadcast(outboundCampaignId: string): Promise<void> {
    const prisma = new PrismaClient();
    try {
      await prisma.broadcast.upsert({
        where: { outboundCampaignId },
        create: {
          // only connect the required relation; all other fields use Prisma defaults
          outboundCampaign: { connect: { id: outboundCampaignId } },
          // selectedTemplateId intentionally omitted (remains null)
        },
        update: {},
      });
    } catch (err) {
      this.logger.warn(
        `ensureDefaultBroadcast failed for campaign ${outboundCampaignId}: ${(err as Error)?.message}`,
      );
      // swallow on purpose — do not affect campaign creation
    } finally {
      await prisma.$disconnect().catch(() => undefined);
    }
  }

  /* ------------------------------ Create ----------------------------- */

  async create(input: unknown): Promise<OutboundCampaignEntity> {
    const parsed = CreateOutboundCampaignSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException(this.formatZod(parsed.error));
    }
    try {
      // 1) Create the campaign via repository (unchanged)
      const campaign = await this.repo.create(parsed.data);

      // 2) Best-effort: create its Broadcast (no DI changes; relies on schema defaults)
      await this.ensureDefaultBroadcast(campaign.id);

      return campaign;
    } catch (e) {
      this.logger.error(`Create failed: ${(e as Error).message}`);
      this.handlePrisma(e);
    }
  }

  /* ------------------------------ Read ------------------------------- */

  async getById(id: string, agentId?: string): Promise<OutboundCampaignEntity> {
    const validId = this.assertId(id);
    try {
      const entity = await this.repo.findById(validId);
      this.ensureOwnership(entity, agentId);
      return entity!;
    } catch (e) {
      this.logger.error(`GetById failed: ${(e as Error).message}`);
      this.handlePrisma(e);
    }
  }

  async list(query: unknown): Promise<PaginatedResult<OutboundCampaignEntity>> {
    const parsed = QueryOutboundCampaignsSchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(this.formatZod(parsed.error));
    }

    // sanitize search: drop empty strings to avoid unnecessary filter
    const q = parsed.data;
    const normalized: OutboundCampaignQuery = {
      ...q,
      search: q.search?.trim() ? q.search.trim() : undefined,
    };

    try {
      return await this.repo.findMany(normalized);
    } catch (e) {
      this.logger.error(`List failed: ${(e as Error).message}`);
      this.handlePrisma(e);
    }
  }

  /* ----------------------------- Update ------------------------------ */

  async update(
    id: string,
    input: unknown,
    opts?: { agentId?: string },
  ): Promise<OutboundCampaignEntity> {
    const validId = this.assertId(id);

    // Ensure there is at least one field to update
    const parsed = UpdateOutboundCampaignSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException(this.formatZod(parsed.error));
    }
    if (!Object.keys(parsed.data).length) {
      throw new BadRequestException('No fields provided for update');
    }

    // Ownership check
    const current = await this.getById(validId, opts?.agentId);

    try {
      return await this.repo.update(current.id, parsed.data);
    } catch (e) {
      this.logger.error(`Update failed: ${(e as Error).message}`);
      this.handlePrisma(e);
    }
  }

  async setStatus(
    id: string,
    input: unknown,
    opts?: { agentId?: string },
  ): Promise<OutboundCampaignEntity> {
    const validId = this.assertId(id);

    const parsed = SetStatusSchema.safeParse({ id: validId, ...(input as object) });
    if (!parsed.success) {
      throw new BadRequestException(this.formatZod(parsed.error));
    }

    // Ownership check
    await this.getById(validId, opts?.agentId);

    try {
      return await this.repo.setStatus(validId, parsed.data.status as OutboundCampaignStatus);
    } catch (e) {
      this.logger.error(`SetStatus failed: ${(e as Error).message}`);
      this.handlePrisma(e);
    }
  }

  /* ----------------------------- Delete ------------------------------ */

  async remove(id: string, opts?: { agentId?: string }): Promise<void> {
    const validId = this.assertId(id);

    // Ownership check
    await this.getById(validId, opts?.agentId);

    try {
      await this.repo.delete(validId);
    } catch (e) {
      this.logger.error(`Delete failed: ${(e as Error).message}`);
      this.handlePrisma(e);
    }
  }
}
