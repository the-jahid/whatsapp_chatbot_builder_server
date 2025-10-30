// /src/leads/services/lead.service.ts

import { Injectable, NotFoundException, Logger, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { Lead, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service'; // Adjust path as needed
import { QueryLeadDto } from './dto/lead.dto';


/**
 * @interface PaginatedLeadsResult
 * @description Defines the shape of the paginated response for leads.
 */
export interface PaginatedLeadsResult {
  data: Lead[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}


@Injectable()
export class LeadService {
  // Initialize logger with the service name for context
  private readonly logger = new Logger(LeadService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Finds all leads in the system, with filtering, sorting, and pagination.
   * @param query The query parameters for filtering, sorting, and pagination.
   * @returns A promise that resolves to a paginated result of Lead objects.
   */
  async findAllLeads(query: QueryLeadDto): Promise<PaginatedLeadsResult> {
    const { status, source, page = 1, limit = 10, sortBy = 'updatedAt', sortOrder = 'desc', createdAfter, createdBefore } = query;

    const where: Prisma.LeadWhereInput = {};
    if (status) where.status = status;
    if (source) where.source = { contains: source, mode: 'insensitive' };
    
    if (createdAfter || createdBefore) {
      where.createdAt = {};
      if (createdAfter) where.createdAt.gte = createdAfter;
      if (createdBefore) where.createdAt.lte = createdBefore;
    }

    const orderBy = { [sortBy]: sortOrder } as Prisma.LeadOrderByWithRelationInput;

    try {
      const [data, total] = await this.prisma.$transaction([
        this.prisma.lead.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy,
        }),
        this.prisma.lead.count({ where }),
      ]);

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        this.logger.warn(`Prisma validation error on findAllLeads: ${error.message}`);
        throw new BadRequestException(`Invalid query parameter provided. Check the 'sortBy' field: ${sortBy}`);
      }
      this.logger.error(`Failed to find all leads: ${error.message}`, error.stack);
      throw new InternalServerErrorException('An error occurred while fetching leads.');
    }
  }

  /**
   * Finds all leads for a specific agent, with filtering, sorting, and pagination.
   * @param agentId The ID of the agent whose leads to retrieve.
   * @param query The query parameters for filtering, sorting, and pagination.
   * @returns A promise that resolves to a paginated result of Lead objects.
   */
  async findLeadsByAgent(agentId: string, query: QueryLeadDto): Promise<PaginatedLeadsResult> {
    const { status, source, page = 1, limit = 10, sortBy = 'updatedAt', sortOrder = 'desc', createdAfter, createdBefore } = query;

    const where: Prisma.LeadWhereInput = { agentId };
    if (status) where.status = status;
    if (source) where.source = { contains: source, mode: 'insensitive' };
    
    if (createdAfter || createdBefore) {
      where.createdAt = {};
      if (createdAfter) where.createdAt.gte = createdAfter;
      if (createdBefore) where.createdAt.lte = createdBefore;
    }

    const orderBy = { [sortBy]: sortOrder } as Prisma.LeadOrderByWithRelationInput;

    try {
      const [data, total] = await this.prisma.$transaction([
        this.prisma.lead.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy,
        }),
        this.prisma.lead.count({ where }),
      ]);

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        this.logger.warn(`Prisma validation error on findLeadsByAgent: ${error.message}`);
        throw new BadRequestException(`Invalid query parameter provided. Check the 'sortBy' field: ${sortBy}`);
      }
      this.logger.error(`Failed to find leads for agent ${agentId}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('An error occurred while fetching leads.');
    }
  }

  /**
   * Finds a single lead by its ID, ensuring it belongs to the specified agent.
   * @param id The ID of the lead to retrieve.
   * @param agentId The ID of the agent who owns the lead.
   * @returns A promise that resolves to the found Lead object.
   */
  async findOne(id: string, agentId: string): Promise<Lead> {
    const lead = await this.prisma.lead.findFirst({
      where: { id, agentId },
    });

    if (!lead) {
      this.logger.warn(`Lead with ID "${id}" not found for agent "${agentId}"`);
      throw new NotFoundException(`Lead with ID "${id}" not found.`);
    }

    return lead;
  }

  /**
   * Removes a lead from the database.
   * @param id The ID of the lead to remove.
   * @param agentId The ID of the agent who owns the lead.
   * @returns A promise that resolves to the removed Lead object.
   */
  async remove(id: string, agentId: string): Promise<Lead> {
    await this.findOne(id, agentId);

    try {
      return await this.prisma.lead.delete({
        where: { id },
      });
    } catch (error) {
      this.logger.error(`Failed to remove lead ${id}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Could not remove lead.');
    }
  }
}
