// src/agent-modules/outbound-lead/outbound-lead.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Prisma, OutboundLeadStatus } from '@prisma/client';

import { OutboundLeadRepository } from './repository/outbound-lead.repository';

import { CreateOutboundLeadDto } from './dto/create-outbound-lead.dto';

import { QueryOutboundLeadsDto } from './dto/query-outbound-leads.dto';
import { SetLeadStatusDto } from './dto/set-status.dto';
import { RecordAttemptDto } from './dto/record-attempt.dto';
import { UpsertCustomFieldsDto } from './dto/upsert-custom-fields.dto';

import { IOutboundLead } from './interface/outbound-lead.interface';

// dynamic custom-field intake service
import { LeadCustomFieldIntakeService } from '../lead-custom-field-intake/lead-custom-field-intake.service';


import { PrismaService } from 'src/prisma/prisma.service';
import { OutboundBroadcastService } from '../outbound-broadcast/outbound-broadcast.service';
import { UpdateOutboundLeadDto } from './dto/update-outbound-lead.dto';

@Injectable()
export class OutboundLeadService {
  private readonly logger = new Logger(OutboundLeadService.name);

  constructor(
    private readonly repo: OutboundLeadRepository,
    private readonly fieldSvc: LeadCustomFieldIntakeService,
    private readonly prisma: PrismaService,
    private readonly broadcastSvc: OutboundBroadcastService,
  ) {}

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  /** Create a lead under a specific campaign (campaignId is a PATH param). */
  async create(
    campaignId: string,
    dto: CreateOutboundLeadDto,
  ): Promise<IOutboundLead> {
    try {
      const phone = dto.phoneNumber.trim();
      if (!phone) throw new BadRequestException('phoneNumber is required');

      // Load campaign field names
      const allowed = await this.getAllowedFieldNames(campaignId);

      // If campaign defines any fields => all of them are required at creation
      if (allowed.size > 0) {
        if (dto.customFields === undefined || dto.customFields === null) {
          throw new BadRequestException(
            `customFields is required for this campaign and must include: ${[
              ...allowed,
            ].join(', ')}`,
          );
        }
        const provided = this.ensureCustomFieldsObject(dto.customFields);
        const missing = this.findMissingRequired(allowed, provided);
        if (missing.length) {
          throw new BadRequestException(
            `Missing required custom field(s): ${missing.join(', ')}`,
          );
        }
      }

      // Also block unknown keys / invalid structure
      if (dto.customFields !== undefined && dto.customFields !== null) {
        await this.ensureCustomFieldsAllowed(campaignId, dto.customFields);
      }

      const created = await this.repo.create(campaignId, {
        phoneNumber: phone,
        firstName: dto.firstName?.trim(),
        timeZone: dto.timeZone ?? 'UTC',
        status: dto.status ?? OutboundLeadStatus.QUEUED,
        maxAttempts: dto.maxAttempts ?? 3,
        customFields: dto.customFields ?? undefined,
      });

      // 🔔 Immediately start/enable the campaign's broadcast after adding a lead
      //     (safe/idempotent; won't throw back to the client)
      this.startCampaignIfPossible(campaignId).catch((err) =>
        this.logger.error(
          `[startCampaignAfterCreate] campaignId=${campaignId} -> ${err?.message || err}`,
        ),
      );

      return created;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') throw new ConflictException('Lead already exists');
        if (e.code === 'P2003') throw new NotFoundException('Campaign not found');
      }
      this.mapAndThrow(e, 'creating lead', { campaignId, dto });
    }
  }

  /** List leads for a campaign (paginated, filterable). */
  async findMany(
    campaignId: string,
    q: QueryOutboundLeadsDto,
  ) {
    try {
      return await this.repo.findMany({
        ...q,
        outboundCampaignId: campaignId,
      });
    } catch (e) {
      this.mapAndThrow(e, 'listing leads', { campaignId, q });
    }
  }

  /** Get one lead by id. */
  async findOne(id: string): Promise<IOutboundLead> {
    try {
      const found = await this.repo.findById(id);
      if (!found) throw new NotFoundException('Lead not found');
      return found;
    } catch (e) {
      this.mapAndThrow(e, 'reading lead', { id });
    }
  }

  /** Update mutable fields. */
  async update(
    id: string,
    dto: UpdateOutboundLeadDto,
  ): Promise<IOutboundLead> {
    const current = await this.ensureExists(id);

    try {
      const phone = dto.phoneNumber?.trim();
      const first = dto.firstName?.trim();

      if (dto.phoneNumber !== undefined && !phone) {
        throw new BadRequestException('phoneNumber cannot be empty');
      }
      if (dto.firstName !== undefined && first === '') {
        throw new BadRequestException('firstName cannot be empty');
      }

      // Validate customFields if provided (and not null/clear)
      if (dto.customFields !== undefined && dto.customFields !== null) {
        await this.ensureCustomFieldsAllowed(current.outboundCampaignId, dto.customFields);
      }

      return await this.repo.update(id, {
        phoneNumber: phone,
        firstName: dto.firstName === undefined ? undefined : first ?? null,
        timeZone: dto.timeZone,
        status: dto.status,
        maxAttempts: dto.maxAttempts,
        customFields: dto.customFields, // null clears (handled in repo)
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Lead already exists');
      }
      this.mapAndThrow(e, 'updating lead', { id, dto });
    }
  }

  /** Delete a lead. */
  async remove(id: string): Promise<IOutboundLead> {
    await this.ensureExists(id);
    try {
      return await this.repo.remove(id);
    } catch (e) {
      this.mapAndThrow(e, 'deleting lead', { id });
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async setStatus(id: string, dto: SetLeadStatusDto): Promise<IOutboundLead> {
    await this.ensureExists(id);
    try {
      return await this.repo.setStatus(id, dto.status);
    } catch (e) {
      this.mapAndThrow(e, 'setting lead status', { id, status: dto.status });
    }
  }

  async recordAttempt(id: string, dto: RecordAttemptDto): Promise<IOutboundLead> {
    await this.ensureExists(id);
    try {
      const inc = dto.attemptsIncrement ?? 1;
      const when = dto.lastAttemptAt ?? new Date();
      return await this.repo.recordAttempt(id, inc, when);
    } catch (e) {
      this.mapAndThrow(e, 'recording attempt', { id, dto });
    }
  }

  /** Merge/replace JSONB customFields with schema validation against campaign fields. */
  async upsertCustomFields(
    id: string,
    dto: UpsertCustomFieldsDto,
  ): Promise<IOutboundLead> {
    const current = await this.ensureExists(id);

    try {
      const mode = dto.mode ?? 'merge';
      if (dto.data === undefined) {
        throw new BadRequestException('data is required');
      }

      // Validate the payload keys against the campaign's allowed fields
      await this.ensureCustomFieldsAllowed(current.outboundCampaignId, dto.data);

      return await this.repo.upsertCustomFields(id, mode, dto.data);
    } catch (e) {
      this.mapAndThrow(e, 'upserting customFields', { id, dto });
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async ensureExists(id: string): Promise<IOutboundLead> {
    try {
      const found = await this.repo.findById(id);
      if (!found) throw new NotFoundException('Lead not found');
      return found;
    } catch (e) {
      this.mapAndThrow(e, 'checking lead existence', { id });
    }
  }

  /**
   * After a new lead is created, ensure the campaign is enabled for broadcast.
   * Safe to call repeatedly; startCampaign is idempotent.
   */
  private async startCampaignIfPossible(campaignId: string): Promise<void> {
    try {
      const campaign = await this.prisma.outboundCampaign.findUnique({
        where: { id: campaignId },
        select: { agentId: true },
      });
      if (!campaign?.agentId) return;

      await this.broadcastSvc.startCampaign(campaign.agentId, campaignId);
    } catch (err: any) {
      // Do not throw back to caller; just log
      this.logger.error(
        `[startCampaignIfPossible] campaignId=${campaignId} -> ${err?.message || err}`,
      );
    }
  }

  /** Load allowed custom-field names for a campaign as a Set. */
  private async getAllowedFieldNames(campaignId: string): Promise<Set<string>> {
    const { data } = await this.fieldSvc.findMany(campaignId, {
      page: 1,
      limit: 1000,
      sortBy: 'createdAt',
      sortOrder: 'asc',
    });
    return new Set((data ?? []).map((f) => f.name));
  }

  /** Ensure provided customFields object only contains keys that are defined for the campaign. */
  private async ensureCustomFieldsAllowed(
    campaignId: string,
    provided: unknown,
  ): Promise<void> {
    const obj = this.ensureCustomFieldsObject(provided);
    const allowed = await this.getAllowedFieldNames(campaignId);

    // if campaign has no definitions but client tries to set keys → error
    if (allowed.size === 0 && Object.keys(obj).length > 0) {
      throw new BadRequestException('No custom fields are defined for this campaign');
    }

    const invalid = Object.keys(obj).filter((k) => !allowed.has(k));
    if (invalid.length) {
      throw new BadRequestException(
        `Unknown custom field(s) for this campaign: ${invalid.join(', ')}`,
      );
    }
  }

  /** Validate object shape for customFields and return typed object. */
  private ensureCustomFieldsObject(v: unknown): Record<string, unknown> {
    if (!this.isPlainObject(v)) {
      throw new BadRequestException('customFields must be an object');
    }
    return v as Record<string, unknown>;
  }

  /** Which required fields are missing/empty? */
  private findMissingRequired(
    required: Set<string>,
    provided: Record<string, unknown>,
  ): string[] {
    const missing: string[] = [];
    for (const key of required) {
      if (!(key in provided)) {
        missing.push(key);
        continue;
      }
      const val = provided[key];
      if (val === null || val === undefined) {
        missing.push(key);
        continue;
      }
      if (typeof val === 'string' && val.trim() === '') {
        missing.push(key);
      }
    }
    return missing;
  }

  private isPlainObject(v: unknown): v is Record<string, unknown> {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  private mapAndThrow(error: any, when: string, meta?: Record<string, unknown>): never {
    this.logger.error(`[${when}] ${error?.message ?? error}`, meta ?? {});
    if (
      error instanceof NotFoundException ||
      error instanceof BadRequestException ||
      error instanceof ConflictException
    ) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') throw new NotFoundException('Lead not found');
      if (error.code === 'P2003') throw new BadRequestException('Invalid reference provided');
      if (error.code === 'P2002') throw new ConflictException('Lead already exists');
    }
    throw new InternalServerErrorException('Unexpected error while processing lead');
  }
}
