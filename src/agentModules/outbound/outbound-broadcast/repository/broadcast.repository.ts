// src/modules/outbound-broadcast/repository/broadcast.repository.ts
import {
  PrismaClient,
  Prisma,
  Broadcast,
  BroadcastStatus,
} from '@prisma/client';

import type {
  CreateBroadcastDto,
  UpdateBroadcastDto,
  GetBroadcastsQueryDto,
} from '../dto';
import type { BroadcastOrderBy } from '../interface';

/* -------------------------------------------------------------------------- */
/*                         SAFETY LIMIT (SINGLE MESSAGE GAP)                  */
/* -------------------------------------------------------------------------- */

const SAFE = {
  MESSAGE_GAP_SEC: { MIN: 0, MAX: 86_400, DEF: 120 }, // 0..24h, default 120s
} as const;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** Apply safe defaults and clamp values. */
function normalizeCreateOrUpsertInput(input: Partial<CreateBroadcastDto>) {
  return {
    isEnabled: input.isEnabled ?? false,
    isPaused: input.isPaused ?? false,
    startAt: input.startAt ?? undefined, // pass undefined to omit; allow null explicitly on update
    selectedTemplateId: input.selectedTemplateId ?? undefined,
    messageGapSeconds: clamp(
      (input.messageGapSeconds ?? SAFE.MESSAGE_GAP_SEC.DEF),
      SAFE.MESSAGE_GAP_SEC.MIN,
      SAFE.MESSAGE_GAP_SEC.MAX,
    ),
  };
}

/** Clamp only if a value is provided (used for partial updates). */
function clampIfProvided<T extends number | undefined>(
  v: T,
  min: number,
  max: number,
): T {
  if (typeof v === 'number') {
    return clamp(v, min, max) as T;
  }
  return v;
}

function toOrderBy(
  orderBy?: BroadcastOrderBy,
): Prisma.BroadcastOrderByWithRelationInput {
  switch (orderBy) {
    case 'createdAt:asc':
      return { createdAt: 'asc' };
    case 'updatedAt:desc':
      return { updatedAt: 'desc' };
    case 'updatedAt:asc':
      return { updatedAt: 'asc' };
    case 'createdAt:desc':
    default:
      return { createdAt: 'desc' };
  }
}

function toWhere(
  q?: GetBroadcastsQueryDto,
): Prisma.BroadcastWhereInput | undefined {
  if (!q) return undefined;
  const where: Prisma.BroadcastWhereInput = {};
  if (q.outboundCampaignId) where.outboundCampaignId = q.outboundCampaignId;
  if (typeof q.isEnabled === 'boolean') where.isEnabled = q.isEnabled;
  if (typeof q.isPaused === 'boolean') where.isPaused = q.isPaused;
  if (q.status) where.status = q.status;
  return where;
}

/**
 * Prisma-powered repository for Broadcasts.
 * Inject your PrismaService.prisma (PrismaClient) here.
 */
export class BroadcastRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /* ------------------------------- Queries ------------------------------- */

  async findById(id: string): Promise<Broadcast | null> {
    return this.prisma.broadcast.findUnique({ where: { id } });
  }

  async findMany(q: GetBroadcastsQueryDto): Promise<Broadcast[]> {
    const { take = 20, skip = 0, cursor, orderBy } = q;
    return this.prisma.broadcast.findMany({
      where: toWhere(q),
      take,
      skip,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: toOrderBy(orderBy),
    });
  }

  /* ------------------------------- Mutations ------------------------------ */

  async create(input: CreateBroadcastDto): Promise<Broadcast> {
    const normalized = normalizeCreateOrUpsertInput(input);

    return this.prisma.broadcast.create({
      data: {
        // relation to campaign stays as nested connect
        outboundCampaign: { connect: { id: input.outboundCampaignId } },

        // scalar assignment (schema uses selectedTemplateId)
        selectedTemplateId: normalized.selectedTemplateId,

        startAt: normalized.startAt,
        isEnabled: normalized.isEnabled,
        isPaused: normalized.isPaused,

        // single-message gap (seconds)
        messageGapSeconds: normalized.messageGapSeconds,
      },
    });
  }

  /**
   * Upsert using the unique 1:1 on `outboundCampaignId`.
   */
  async upsertForCampaign(
    outboundCampaignId: string,
    input: Omit<CreateBroadcastDto, 'outboundCampaignId'>,
  ): Promise<Broadcast> {
    const normalized = normalizeCreateOrUpsertInput(input);

    return this.prisma.broadcast.upsert({
      where: { outboundCampaignId },
      create: {
        outboundCampaign: { connect: { id: outboundCampaignId } },
        selectedTemplateId: normalized.selectedTemplateId,
        startAt: normalized.startAt,
        isEnabled: normalized.isEnabled,
        isPaused: normalized.isPaused,
        messageGapSeconds: normalized.messageGapSeconds,
      },
      update: {
        // allow explicit null to clear; undefined to ignore
        selectedTemplateId:
          input.selectedTemplateId === null ? null : input.selectedTemplateId ?? undefined,
        startAt: input.startAt === undefined ? undefined : input.startAt, // pass null or date
        isEnabled: input.isEnabled ?? undefined,
        isPaused: input.isPaused ?? undefined,

        messageGapSeconds: clampIfProvided(
          input.messageGapSeconds,
          SAFE.MESSAGE_GAP_SEC.MIN,
          SAFE.MESSAGE_GAP_SEC.MAX,
        ),
      },
    });
  }

  async update(id: string, input: UpdateBroadcastDto): Promise<Broadcast> {
    const data: Prisma.BroadcastUpdateInput = {
      // explicit null allowed via schema, undefined to skip
      startAt: input.startAt === undefined ? undefined : input.startAt,
      status: input.status ?? undefined,
      isEnabled: input.isEnabled ?? undefined,
      isPaused: input.isPaused ?? undefined,

      messageGapSeconds: clampIfProvided(
        input.messageGapSeconds,
        SAFE.MESSAGE_GAP_SEC.MIN,
        SAFE.MESSAGE_GAP_SEC.MAX,
      ),

      // scalar assignment for template (undefined: ignore, null: clear, uuid: set)
      selectedTemplateId:
        input.selectedTemplateId === undefined ? undefined : input.selectedTemplateId,
    };

    return this.prisma.broadcast.update({ where: { id }, data });
  }

  async delete(id: string): Promise<Broadcast> {
    return this.prisma.broadcast.delete({ where: { id } });
  }

  /* ------------------------ Convenience transitions ----------------------- */

  async setStatus(id: string, status: BroadcastStatus): Promise<Broadcast> {
    return this.prisma.broadcast.update({ where: { id }, data: { status } });
  }

  async setEnabled(id: string, isEnabled: boolean): Promise<Broadcast> {
    const existing = await this.findById(id);
    if (!existing) throw new Error('Broadcast not found');

    // READY means allowed to run when due; service decides RUNNING vs READY by startAt.
    let nextStatus = existing.status;
    if (isEnabled && !existing.isPaused && existing.selectedTemplateId) {
      if (existing.status === 'DRAFT' || existing.status === 'PAUSED') {
        nextStatus = 'READY';
      }
    }
    return this.prisma.broadcast.update({
      where: { id },
      data: { isEnabled, status: nextStatus },
    });
  }

  async setPaused(id: string, isPaused: boolean): Promise<Broadcast> {
    const existing = await this.findById(id);
    if (!existing) throw new Error('Broadcast not found');

    let nextStatus = existing.status;
    if (isPaused && (existing.status === 'READY' || existing.status === 'RUNNING')) {
      nextStatus = 'PAUSED';
    } else if (!isPaused && existing.isEnabled && existing.selectedTemplateId) {
      if (existing.status === 'PAUSED') nextStatus = 'READY';
    }

    return this.prisma.broadcast.update({
      where: { id },
      data: { isPaused, status: nextStatus },
    });
  }

  async attachTemplate(id: string, templateId: string | null): Promise<Broadcast> {
    const existing = await this.findById(id);
    if (!existing) throw new Error('Broadcast not found');

    let nextStatus = existing.status;
    if (templateId && existing.isEnabled && !existing.isPaused) {
      if (existing.status === 'DRAFT' || existing.status === 'PAUSED') {
        nextStatus = 'READY';
      }
    } else if (!templateId && existing.status === 'READY') {
      nextStatus = 'DRAFT';
    }

    return this.prisma.broadcast.update({
      where: { id },
      data: {
        status: nextStatus,
        selectedTemplateId: templateId, // scalar write
      },
    });
  }

  async incrementCounters(
    id: string,
    deltas: { queued?: number; sent?: number; failed?: number },
  ): Promise<Broadcast> {
    const { queued = 0, sent = 0, failed = 0 } = deltas;
    return this.prisma.broadcast.update({
      where: { id },
      data: {
        totalQueued: queued ? { increment: queued } : undefined,
        totalSent: sent ? { increment: sent } : undefined,
        totalFailed: failed ? { increment: failed } : undefined,
      },
    });
  }

  async resetCounters(id: string): Promise<Broadcast> {
    return this.prisma.broadcast.update({
      where: { id },
      data: { totalQueued: 0, totalSent: 0, totalFailed: 0 },
    });
  }
}
