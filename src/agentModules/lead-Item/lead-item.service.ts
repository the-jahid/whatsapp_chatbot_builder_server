// src/lead-item/lead-item.service.ts
import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { LeadItem, Prisma } from '@prisma/client';
import {
  CreateLeadItemDto,
  UpdateLeadItemDto,
  GetAllLeadItemsQueryDto,
} from './dto/lead-item.dto';

export interface PaginatedLeadItemsResult {
  data: LeadItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Allow-list of sortable fields */
type LeadItemSortableFields = 'name' | 'description' | 'createdAt' | 'updatedAt';

@Injectable()
export class LeadItemService {
  private readonly logger = new Logger(LeadItemService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Used by RunAgentService (lead capture flow):
   * Return deduplicated, ordered list of fields for an agent,
   * ensuring each item has a friendly description.
   */
  async getRequiredFields(agentId: string): Promise<LeadItem[]> {
    const items = await this.prisma.leadItem.findMany({
      where: { agentId },
      orderBy: { createdAt: 'asc' },
    });

    if (!items.length) {
      this.logger.warn(
        `[LeadItemService] No lead items configured for agent=${agentId}`,
      );
      throw new NotFoundException('No lead fields configured for this agent.');
    }

    // Deduplicate by normalized name
    const seen = new Set<string>();
    const unique = items.filter((it) => {
      const key = it.name.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return unique.map((item) => ({
      ...item,
      description:
        item.description ?? `Collect information for "${item.name}"`,
    }));
  }

  /** Create a new lead item, asserting agent existence and uniqueness (agentId, name). */
  async create(createLeadItemDto: CreateLeadItemDto) {
    const { agentId, name } = createLeadItemDto;

    // Ensure agent exists
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true },
    });
    if (!agent) {
      throw new NotFoundException(`Agent with ID "${agentId}" not found.`);
    }

    try {
      return await this.prisma.leadItem.create({ data: createLeadItemDto });
    } catch (error: any) {
      // P2002 => unique constraint violation (expect @@unique([agentId, name]))
      if (error?.code === 'P2002') {
        throw new ConflictException(
          `A lead item named "${name}" already exists for this agent.`,
        );
      }
      throw error;
    }
  }

  /**
   * List lead items for an agent with safe filters, pagination, and sorting.
   * - Guards sortBy/sortOrder at runtime to avoid arbitrary field injection.
   */
  async findAllForAgent(
    agentId: string,
    query: GetAllLeadItemsQueryDto,
  ): Promise<PaginatedLeadItemsResult> {
    const {
      page,
      limit,
      sortBy: rawSortBy,
      sortOrder: rawSortOrder,
      name,
      description,
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.LeadItemWhereInput = {
      agentId,
      ...(name
        ? { name: { contains: name, mode: 'insensitive' } }
        : {}),
      ...(description
        ? { description: { contains: description, mode: 'insensitive' } }
        : {}),
    };

    // --- Sort guards ---
    const allowedSort: LeadItemSortableFields[] = [
      'name',
      'description',
      'createdAt',
      'updatedAt',
    ];
    const sortBy: LeadItemSortableFields = allowedSort.includes(
      rawSortBy as LeadItemSortableFields,
    )
      ? (rawSortBy as LeadItemSortableFields)
      : 'createdAt';

    const sortOrder: 'asc' | 'desc' =
      rawSortOrder === 'asc' || rawSortOrder === 'desc'
        ? rawSortOrder
        : 'desc';

    const orderBy: Prisma.LeadItemOrderByWithRelationInput = {
      [sortBy]: sortOrder,
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.leadItem.findMany({ where, skip, take: limit, orderBy }),
      this.prisma.leadItem.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  /** Get single record by id */
  async findOne(id: string) {
    const leadItem = await this.prisma.leadItem.findUnique({ where: { id } });
    if (!leadItem) {
      throw new NotFoundException(`Lead Item with ID "${id}" not found.`);
    }
    return leadItem;
  }

  /**
   * Update with conflict handling (unique composite agentId+name).
   * Assumes your Prisma model has: @@unique([agentId, name])
   */
  async update(id: string, updateLeadItemDto: UpdateLeadItemDto) {
    // Ensure it exists first for consistent 404
    await this.findOne(id);

    try {
      return await this.prisma.leadItem.update({
        where: { id },
        data: updateLeadItemDto,
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        // Conflicts with @@unique([agentId, name])
        throw new ConflictException(
          `A lead item named "${updateLeadItemDto.name}" already exists for this agent.`,
        );
      }
      throw error;
    }
  }

  /** Delete by id (controller can return 204) */
  async remove(id: string) {
    // Ensure it exists
    await this.findOne(id);
    await this.prisma.leadItem.delete({ where: { id } });
  }
}
