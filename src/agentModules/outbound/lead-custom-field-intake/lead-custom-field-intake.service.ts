
// src/agent-modules/lead-custom-field-intake/lead-custom-field-intake.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { LeadCustomFieldIntakeRepository } from './repository/lead-custom-field-intake.repository';

import { CreateLeadCustomFieldIntakeDto } from './dto/create-lead-custom-field-intake.dto';
import { UpdateLeadCustomFieldIntakeDto } from './dto/update-lead-custom-field-intake.dto';
import { QueryLeadCustomFieldIntakesDto } from './dto/query-lead-custom-field-intakes.dto';

import { ILeadCustomFieldIntake } from './interface/lead-custom-field-intake.interface';

@Injectable()
export class LeadCustomFieldIntakeService {
  private readonly logger = new Logger(LeadCustomFieldIntakeService.name);

  constructor(private readonly repo: LeadCustomFieldIntakeRepository) {}

  // ------------------------------------------------------------------
  // CRUD
  // ------------------------------------------------------------------

  /** Create a custom field for a specific campaign (campaignId is a PATH param). */
  async create(
    campaignId: string,
    dto: CreateLeadCustomFieldIntakeDto,
  ): Promise<ILeadCustomFieldIntake> {
    try {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('name is required');
      return await this.repo.create(campaignId, { name });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        // Unique violation (either global name or per-campaign composite)
        if (e.code === 'P2002') {
          throw new ConflictException('A field with this name already exists');
        }
        // FK violation: campaign doesn’t exist
        if (e.code === 'P2003') {
          throw new NotFoundException('Campaign not found');
        }
      }
      this.mapAndThrow(e, 'creating custom field', { campaignId, dto });
    }
  }

  /** List all custom fields in a campaign (paginated, searchable). */
  async findMany(
    campaignId: string,
    q: QueryLeadCustomFieldIntakesDto,
  ) {
    try {
      // Force scope by campaignId from path
      return await this.repo.findMany({
        ...q,
        outboundCampaignId: campaignId,
      });
    } catch (e) {
      this.mapAndThrow(e, 'listing custom fields', { campaignId, q });
    }
  }

  /** Get one by id. */
  async findOne(id: string): Promise<ILeadCustomFieldIntake> {
    try {
      const found = await this.repo.findById(id);
      if (!found) throw new NotFoundException('Custom field not found');
      return found;
    } catch (e) {
      this.mapAndThrow(e, 'reading custom field', { id });
    }
  }

  /** Update the name (idempotent, trims input). */
  async update(
    id: string,
    dto: UpdateLeadCustomFieldIntakeDto,
  ): Promise<ILeadCustomFieldIntake> {
    await this.ensureExists(id);

    try {
      const name = dto.name?.trim();
      if (dto.name !== undefined && !name) {
        throw new BadRequestException('name cannot be empty');
      }
      return await this.repo.update(id, { name });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A field with this name already exists');
      }
      this.mapAndThrow(e, 'updating custom field', { id, dto });
    }
  }

  /** Delete a custom field by id. */
  async remove(id: string): Promise<ILeadCustomFieldIntake> {
    await this.ensureExists(id);
    try {
      return await this.repo.remove(id);
    } catch (e) {
      this.mapAndThrow(e, 'deleting custom field', { id });
    }
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async ensureExists(id: string): Promise<ILeadCustomFieldIntake> {
    try {
      const found = await this.repo.findById(id);
      if (!found) throw new NotFoundException('Custom field not found');
      return found;
    } catch (e) {
      this.mapAndThrow(e, 'checking custom field existence', { id });
    }
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
      // Prisma fallbacks
      if (error.code === 'P2025') throw new NotFoundException('Custom field not found');
      if (error.code === 'P2003') throw new BadRequestException('Invalid reference provided');
      if (error.code === 'P2002') throw new ConflictException('A field with this name already exists');
    }
    throw new InternalServerErrorException('Unexpected error while processing custom fields');
  }
}























