import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma, AppointmentLeadItem as PrismaAppointmentLeadItem } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

import {
  AppointmentLeadItemEntity,
  CreateAppointmentLeadItemInput,
  UpdateAppointmentLeadItemInput,
  QueryAppointmentLeadItems,
  PaginatedResult,
  IAppointmentLeadItemService,
} from './interface/appointment-lead-item.interface';

@Injectable()
export class AppointmentLeadItemService implements IAppointmentLeadItemService {
  private readonly logger = new Logger(AppointmentLeadItemService.name);
  private static readonly PAGE_SIZE_DEFAULT = 20;
  private static readonly PAGE_SIZE_MAX = 100;

  constructor(private readonly prisma: PrismaService) {}

  // ----------------------
  // Public API
  // ----------------------

  async create(input: CreateAppointmentLeadItemInput): Promise<AppointmentLeadItemEntity> {
    try {
      // Pre-check: unique name per agent
      const dup = await this.prisma.appointmentLeadItem.findFirst({
        where: { agentId: input.agentId, name: input.name },
        select: { id: true },
      });
      if (dup) {
        throw new ConflictException('An item with this name already exists for the agent');
      }

      const created = await this.prisma.appointmentLeadItem.create({
        data: {
          agentId: input.agentId,
          name: input.name,
          description: input.description ?? null,
        },
      });

      return this.map(created);
    } catch (e) {
      this.handlePrismaError(e, 'create');
    }
  }

  async update(id: string, input: UpdateAppointmentLeadItemInput): Promise<AppointmentLeadItemEntity> {
    try {
      const existing = await this.prisma.appointmentLeadItem.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException('Appointment lead item not found');
      }

      // If renaming, enforce uniqueness per agent
      if (input.name && input.name !== existing.name) {
        const dup = await this.prisma.appointmentLeadItem.findFirst({
          where: { agentId: existing.agentId, name: input.name, NOT: { id } },
          select: { id: true },
        });
        if (dup) {
          throw new ConflictException('An item with this name already exists for the agent');
        }
      }

      const updated = await this.prisma.appointmentLeadItem.update({
        where: { id },
        data: {
          name: input.name ?? undefined,
          description: input.description ?? undefined,
        },
      });

      return this.map(updated);
    } catch (e) {
      this.handlePrismaError(e, 'update', { id });
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.prisma.appointmentLeadItem.delete({ where: { id } });
    } catch (e) {
      this.handlePrismaError(e, 'delete', { id });
    }
  }

  async getById(id: string): Promise<AppointmentLeadItemEntity | null> {
    try {
      const item = await this.prisma.appointmentLeadItem.findUnique({ where: { id } });
      return item ? this.map(item) : null;
    } catch (e) {
      this.handlePrismaError(e, 'getById', { id });
    }
  }

  async list(query: QueryAppointmentLeadItems): Promise<PaginatedResult<AppointmentLeadItemEntity>> {
    try {
      if (!query.agentId) {
        throw new BadRequestException('agentId is required');
      }

      const takeRaw = query.take ?? AppointmentLeadItemService.PAGE_SIZE_DEFAULT;
      const take =
        takeRaw > AppointmentLeadItemService.PAGE_SIZE_MAX
          ? AppointmentLeadItemService.PAGE_SIZE_MAX
          : takeRaw;

      const where: Prisma.AppointmentLeadItemWhereInput = {
        agentId: query.agentId,
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { description: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : undefined),
      };

      const items = await this.prisma.appointmentLeadItem.findMany({
        where,
        orderBy: { createdAt: 'desc' }, // stable ordering
        take,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });

      const mapped = items.map(this.map);
      const nextCursor = mapped.length === take ? mapped[mapped.length - 1].id : undefined;

      return { items: mapped, nextCursor };
    } catch (e) {
      this.handlePrismaError(e, 'list', { agentId: query.agentId });
    }
  }

  // ----------------------
  // Helpers
  // ----------------------

  private map = (row: PrismaAppointmentLeadItem): AppointmentLeadItemEntity => ({
    id: row.id,
    name: row.name,
    description: row.description,
    agentId: row.agentId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  private handlePrismaError(e: unknown, op: string, context?: Record<string, any>): never {
    // Known Prisma error types
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      // Unique constraint fail
      if (e.code === 'P2002') {
        this.logger.warn(`Prisma P2002 (${op})`, { context, meta: e.meta });
        throw new ConflictException('Resource with the same unique field already exists');
      }
      // Record not found
      if (e.code === 'P2025') {
        this.logger.warn(`Prisma P2025 (${op})`, { context, meta: e.meta });
        throw new NotFoundException('Resource not found');
      }
      // Fallback for other codes
      this.logger.error(`Prisma error (${op}) ${e.code}`, { context, meta: e.meta });
      throw new InternalServerErrorException('Database error');
    }

    // Validation / programming errors surfaced here
    if (e instanceof BadRequestException || e instanceof NotFoundException || e instanceof ConflictException) {
      throw e; // rethrow as-is
    }

    // Unknown error
    this.logger.error(`Unknown error in ${op}: ${(e as any)?.message}`, (e as any)?.stack);
    throw new InternalServerErrorException('Unexpected error');
  }
}
