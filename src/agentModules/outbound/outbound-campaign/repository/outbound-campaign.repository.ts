// src/agent-modules/outbound-campaign/repository/outbound-campaign.repository.ts
import { Injectable } from '@nestjs/common';
import { Prisma, OutboundCampaign, OutboundCampaignStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  OutboundCampaignEntity,
  OutboundCampaignQuery,
  PaginatedResult,
} from '../interface';
import {
  CreateOutboundCampaignInput,
  UpdateOutboundCampaignInput,
} from '../schema';

@Injectable()
export class OutboundCampaignRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateOutboundCampaignInput): Promise<OutboundCampaignEntity> {
    const data: Prisma.OutboundCampaignCreateInput = {
      name: input.name,
      status: input.status ?? OutboundCampaignStatus.DRAFT,
      agent: { connect: { id: input.agentId } },
    };
    return this.prisma.outboundCampaign.create({ data });
  }

  async findById(id: string): Promise<OutboundCampaignEntity | null> {
    return this.prisma.outboundCampaign.findUnique({ where: { id } });
  }

  async update(id: string, input: UpdateOutboundCampaignInput): Promise<OutboundCampaignEntity> {
    const data: Prisma.OutboundCampaignUpdateInput = {};
    if (typeof input.name !== 'undefined') data.name = input.name;
    if (typeof input.status !== 'undefined') data.status = input.status;

    return this.prisma.outboundCampaign.update({
      where: { id },
      data,
    });
  }

  async setStatus(id: string, status: OutboundCampaignStatus): Promise<OutboundCampaignEntity> {
    return this.prisma.outboundCampaign.update({
      where: { id },
      data: { status },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.outboundCampaign.delete({ where: { id } });
  }

  async findMany(query: OutboundCampaignQuery): Promise<PaginatedResult<OutboundCampaignEntity>> {
    const {
      agentId,
      status,
      search,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const where: Prisma.OutboundCampaignWhereInput = {
      agentId,
      ...(status ? { status } : {}),
      ...(search
        ? {
            name: {
              contains: search,
              mode: Prisma.QueryMode.insensitive,
            },
          }
        : {}),
    };

    const orderBy: Prisma.OutboundCampaignOrderByWithRelationInput = {
      [sortBy]: sortOrder,
    } as any;

    const [total, items] = await this.prisma.$transaction([
      this.prisma.outboundCampaign.count({ where }),
      this.prisma.outboundCampaign.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      items,
      page,
      limit,
      total,
      hasNextPage: page * limit < total,
    };
  }
}
