// src/agent-modules/outbound-lead/repository/outbound-lead.repository.ts
import { Injectable } from '@nestjs/common';
import { Prisma, OutboundLeadStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

import { IOutboundLead } from '../interface/outbound-lead.interface';
import {
  IOutboundLeadQuery,
  OutboundLeadSortBy,
} from '../interface/outbound-lead-query.interface';

type Select = Prisma.OutboundLeadSelect;
type Where  = Prisma.OutboundLeadWhereInput;
type Order  = Prisma.OutboundLeadOrderByWithRelationInput;

@Injectable()
export class OutboundLeadRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Map nullable JSON inputs to Prisma sentinels correctly
  private mapJsonNullable(
    v: Prisma.InputJsonValue | null | undefined,
  ): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
    if (v === undefined) return undefined;     // do not touch
    if (v === null) return Prisma.DbNull;      // clear column to SQL NULL
    return v;                                  // normal JSON value
  }

  // ------------------------------------------------------------------
  // CRUD
  // ------------------------------------------------------------------

  async create(
    outboundCampaignId: string,
    data: {
      phoneNumber: string;
      firstName: string;
      timeZone?: string;
      status?: OutboundLeadStatus;
      maxAttempts?: number;
      customFields?: Prisma.InputJsonValue | null;
    },
  ): Promise<IOutboundLead> {
    return this.prisma.outboundLead.create({
      data: {
        outboundCampaignId,
        phoneNumber: data.phoneNumber.trim(),
        firstName: data.firstName?.trim(),
        timeZone: data.timeZone ?? 'UTC',
        status: data.status ?? OutboundLeadStatus.QUEUED,
        maxAttempts: data.maxAttempts ?? 3,
        customFields: this.mapJsonNullable(data.customFields),
      },
    });
  }

  async findById<T extends Select | undefined = undefined>(
    id: string,
    select?: T,
  ): Promise<
    | (T extends undefined
        ? IOutboundLead
        : Prisma.OutboundLeadGetPayload<{ select: T }>)
    | null
  > {
    return (this.prisma.outboundLead.findUnique({
      where: { id },
    
      select,
    }) as unknown) as Promise<
      | (T extends undefined
          ? IOutboundLead
          : Prisma.OutboundLeadGetPayload<{ select: T }>)
      | null
    >;
  }

  async update(
    id: string,
    data: {
      phoneNumber?: string;
      firstName?: string | null;
      timeZone?: string;
      status?: OutboundLeadStatus;
      maxAttempts?: number;
      customFields?: Prisma.InputJsonValue | null; // replaces whole JSON
    },
  ): Promise<IOutboundLead> {
    const payload: Prisma.OutboundLeadUpdateInput = {};
    if (data.phoneNumber !== undefined) payload.phoneNumber = data.phoneNumber.trim();
    if (data.firstName !== undefined)  payload.firstName  = data.firstName?.trim() ?? null;
    if (data.timeZone !== undefined)   payload.timeZone   = data.timeZone;
    if (data.status !== undefined)     payload.status     = data.status;
    if (data.maxAttempts !== undefined) payload.maxAttempts = data.maxAttempts;
    if (data.customFields !== undefined)
      payload.customFields = this.mapJsonNullable(data.customFields);

    return this.prisma.outboundLead.update({
      where: { id },
      data: payload,
    });
  }

  async remove(id: string): Promise<IOutboundLead> {
    return this.prisma.outboundLead.delete({ where: { id } });
  }

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  async setStatus(id: string, status: OutboundLeadStatus): Promise<IOutboundLead> {
    return this.prisma.outboundLead.update({
      where: { id },
      data: { status },
    });
  }

  async recordAttempt(
    id: string,
    attemptsIncrement = 1,
    lastAttemptAt: Date = new Date(),
  ): Promise<IOutboundLead> {
    return this.prisma.outboundLead.update({
      where: { id },
      data: {
        attemptsMade: { increment: attemptsIncrement },
        lastAttemptAt,
      },
    });
  }

  /**
   * Upsert customFields (JSONB).
   * - mode 'replace': sets JSON directly
   * - mode 'merge': shallow-merges with existing object
   */
  async upsertCustomFields(
    id: string,
    mode: 'merge' | 'replace',
    data: Prisma.InputJsonValue,
  ): Promise<IOutboundLead> {
    if (mode === 'replace') {
      return this.prisma.outboundLead.update({
        where: { id },
        data: { customFields: data },
      });
    }

    // merge
    const current = await this.prisma.outboundLead.findUnique({
      where: { id },
      select: { customFields: true },
    });

    const baseObj =
      (current?.customFields && typeof current.customFields === 'object' && !Array.isArray(current.customFields)
        ? (current.customFields as Record<string, any>)
        : {}) ?? {};

    const patchObj =
      (data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, any>)
        : {}) ?? {};

    const merged = { ...baseObj, ...patchObj };

    return this.prisma.outboundLead.update({
      where: { id },
      data: { customFields: merged as unknown as Prisma.InputJsonValue },
    });
  }

  // ------------------------------------------------------------------
  // Query / List
  // ------------------------------------------------------------------

  async findMany(query: IOutboundLeadQuery): Promise<{
    data: IOutboundLead[];
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
      this.prisma.outboundLead.count({ where }),
      this.prisma.outboundLead.findMany({
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

  private buildWhere(q: IOutboundLeadQuery): Where {
    const where: Where = {};

    if (q.outboundCampaignId) {
      where.outboundCampaignId = q.outboundCampaignId;
    }

    if (q.status) {
      where.status = Array.isArray(q.status) ? { in: q.status } : q.status;
    }

    if (q.q && q.q.trim().length) {
      const needle = q.q.trim();
      where.OR = [
        { phoneNumber: { contains: needle, mode: 'insensitive' } },
        { firstName:   { contains: needle, mode: 'insensitive' } },
      ];
    }

    // createdAt range
    if (q.createdFrom || q.createdTo) {
      where.createdAt = {};
      if (q.createdFrom)
        (where.createdAt as Prisma.DateTimeFilter).gte = new Date(q.createdFrom as any);
      if (q.createdTo)
        (where.createdAt as Prisma.DateTimeFilter).lte = new Date(q.createdTo as any);
    }

    // lastAttemptAt range
    if (q.lastAttemptFrom || q.lastAttemptTo) {
      where.lastAttemptAt = {};
      if (q.lastAttemptFrom)
        (where.lastAttemptAt as Prisma.DateTimeFilter).gte = new Date(q.lastAttemptFrom as any);
      if (q.lastAttemptTo)
        (where.lastAttemptAt as Prisma.DateTimeFilter).lte = new Date(q.lastAttemptTo as any);
    }

    return where;
  }

  private buildOrderBy(
    sortBy?: OutboundLeadSortBy,
    sortOrder?: 'asc' | 'desc',
  ): Order {
    const by    = sortBy ?? 'createdAt';
    const order = sortOrder ?? 'desc';

    switch (by) {
      case 'lastAttemptAt':
        return { lastAttemptAt: order };
      case 'status':
        return { status: order };
      case 'phoneNumber':
        return { phoneNumber: order };
      case 'firstName':
        return { firstName: order };
      case 'createdAt':
      default:
        return { createdAt: order };
    }
  }
}
