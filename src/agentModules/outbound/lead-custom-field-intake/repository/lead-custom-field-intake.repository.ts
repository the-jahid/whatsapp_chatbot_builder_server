// src/agent-modules/lead-custom-field-intake/repository/lead-custom-field-intake.repository.ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

import { ILeadCustomFieldIntake } from '../interface/lead-custom-field-intake.interface';
import {
  ILeadCustomFieldIntakeQuery,
  LeadCustomFieldIntakeSortBy,
} from '../interface/lead-custom-field-intake-query.interface';

// ⚠️ Model is defined as `model leadCustomFieldInatake { ... }` (lowercase 'l'),
// so Prisma types must also be lowercase:
type Select = Prisma.leadCustomFieldInatakeSelect;
type Where  = Prisma.leadCustomFieldInatakeWhereInput;
type Order  = Prisma.leadCustomFieldInatakeOrderByWithRelationInput;

@Injectable()
export class LeadCustomFieldIntakeRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------
  // CRUD
  // ------------------------------------------------------------------

  async create(
    campaignId: string,
    data: { name: string },
  ): Promise<ILeadCustomFieldIntake> {
    return this.prisma.leadCustomFieldInatake.create({
      data: {
        name: data.name.trim(),
        outboundCampaignId: campaignId,
      },
    });
  }

  async findById<T extends Select | undefined = undefined>(
    id: string,
    select?: T,
  ): Promise<
    | (T extends undefined
        ? ILeadCustomFieldIntake
        : Prisma.leadCustomFieldInatakeGetPayload<{ select: T }>)
    | null
  > {
    return (this.prisma.leadCustomFieldInatake.findUnique({
      where: { id },
  
      select,
    }) as unknown) as Promise<
      | (T extends undefined
          ? ILeadCustomFieldIntake
          : Prisma.leadCustomFieldInatakeGetPayload<{ select: T }>)
      | null
    >;
  }

  async update(
    id: string,
    data: { name?: string },
  ): Promise<ILeadCustomFieldIntake> {
    const payload: Prisma.leadCustomFieldInatakeUpdateInput = {};
    if (data.name !== undefined) {
      payload.name = data.name.trim();
    }
    return this.prisma.leadCustomFieldInatake.update({
      where: { id },
      data: payload,
    });
  }

  async remove(id: string): Promise<ILeadCustomFieldIntake> {
    return this.prisma.leadCustomFieldInatake.delete({ where: { id } });
  }

  // ------------------------------------------------------------------
  // List / Query
  // ------------------------------------------------------------------

  async findMany(query: ILeadCustomFieldIntakeQuery): Promise<{
    data: ILeadCustomFieldIntake[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page  = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip  = (page - 1) * limit;

    const where   = this.buildWhere(query);
    const orderBy = this.buildOrderBy(query.sortBy, query.sortOrder);

    const [total, data] = await this.prisma.$transaction([
      this.prisma.leadCustomFieldInatake.count({ where }),
      this.prisma.leadCustomFieldInatake.findMany({
        where,
        orderBy,
        skip,
        take: limit,
      }),
    ]);

    return { data, total, page, limit };
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private buildWhere(q: ILeadCustomFieldIntakeQuery): Where {
    const where: Where = {};

    if (q.outboundCampaignId) {
      where.outboundCampaignId = q.outboundCampaignId;
    }

    if (q.q && q.q.trim().length) {
      where.name = { contains: q.q.trim(), mode: 'insensitive' };
    }

    return where;
  }

  private buildOrderBy(
    sortBy?: LeadCustomFieldIntakeSortBy,
    sortOrder?: 'asc' | 'desc',
  ): Order {
    const by    = sortBy ?? 'createdAt';
    const order = sortOrder ?? 'desc';

    switch (by) {
      case 'name':
        return { name: order };
      case 'createdAt':
      default:
        return { createdAt: order };
    }
  }
}
