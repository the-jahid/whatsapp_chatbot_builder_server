// src/agentModules/booking-settings/booking-settings.service.ts
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { z, ZodError } from 'zod';

import { UpsertBookingSettingsDto } from './dto/upsert-booking-settings.dto';
import { PatchBookingSettingsDto } from './dto/patch-booking-settings.dto';
import { UpsertWeeklyAvailabilityDto } from './dto/upsert-weekly-availability.dto';
import { DeleteWeeklyAvailabilityDto } from './dto/delete-weekly-availability.dto';

import {
  bookingSettingsSchema,
  upsertBookingSettingsSchema,
  patchBookingSettingsSchema,
  type BookingSettings as BookingSettingsType,
} from './schema/booking-settings.schema';

import {
  weeklyAvailabilitySchema,
  upsertWeeklyAvailabilitySchema,
  deleteWeeklyAvailabilitySchema,
  type WeeklyAvailability as WeeklyAvailabilityType,
} from './schema/weekly_availability.schema';

import { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

@Injectable()
export class BookingSettingsService {
  private readonly logger = new Logger(BookingSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------- Booking Settings ----------

  async getSettings(agentId: string, userId: string): Promise<BookingSettingsType | null> {
    await this.assertAgentOwned(agentId, userId);
    try {
      const settings = await this.prisma.bookingSettings.findUnique({ where: { agentId } });
      return settings ? bookingSettingsSchema.parse(settings) : null;
    } catch (e) {
      this.handleUnknownError(e, 'getSettings');
    }
  }

  async upsertSettings(
    agentId: string,
    dto: UpsertBookingSettingsDto,
    userId: string,
  ): Promise<BookingSettingsType> {
    await this.assertAgentOwned(agentId, userId);

    const data = this.safeParse(upsertBookingSettingsSchema, dto, 'Invalid booking settings payload');

    try {
      const saved = await this.prisma.bookingSettings.upsert({
        where: { agentId },
        create: { ...data, agentId },
        update: { ...data },
      });
      return bookingSettingsSchema.parse(saved);
    } catch (e) {
      this.handlePrismaError(e, 'upsertSettings');
    }
  }

  async patchSettings(
    agentId: string,
    dto: PatchBookingSettingsDto,
    userId: string,
  ): Promise<BookingSettingsType> {
    await this.assertAgentOwned(agentId, userId);

    const existing = await this.prisma.bookingSettings.findUnique({ where: { agentId } });
    if (!existing) throw new NotFoundException('Booking settings not found for this agent');

    const data = this.safeParse(patchBookingSettingsSchema, dto, 'Invalid booking settings patch');

    try {
      const updated = await this.prisma.bookingSettings.update({
        where: { agentId },
        data,
      });
      return bookingSettingsSchema.parse(updated);
    } catch (e) {
      this.handlePrismaError(e, 'patchSettings');
    }
  }

  async deleteSettings(agentId: string, userId: string): Promise<void> {
    await this.assertAgentOwned(agentId, userId);
    try {
      await this.prisma.bookingSettings.delete({ where: { agentId } });
    } catch (e) {
      if (e instanceof PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new NotFoundException('Booking settings not found');
      }
      this.handlePrismaError(e, 'deleteSettings');
    }
  }

  // ---------- Weekly Availability ----------

  async getAvailability(agentId: string, userId: string): Promise<WeeklyAvailabilityType[]> {
    await this.assertAgentOwned(agentId, userId);
    try {
      const rows = await this.prisma.weeklyAvailability.findMany({
        where: { agentId },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      });
      return rows.map((r) => weeklyAvailabilitySchema.parse(r));
    } catch (e) {
      this.handleUnknownError(e, 'getAvailability');
    }
  }

  async upsertAvailability(
    agentId: string,
    dto: UpsertWeeklyAvailabilityDto,
    userId: string,
  ): Promise<WeeklyAvailabilityType[]> {
    await this.assertAgentOwned(agentId, userId);

    const { windows } = this.safeParse(
      upsertWeeklyAvailabilitySchema,
      dto,
      'Invalid weekly availability payload',
    );

    const settings = await this.prisma.bookingSettings.findUnique({ where: { agentId } });
    const slot = settings?.appointmentSlot;

    this.assertNoOverlapsAndAligned(windows, slot);

    try {
      await this.prisma.$transaction([
        this.prisma.weeklyAvailability.deleteMany({ where: { agentId } }),
        this.prisma.weeklyAvailability.createMany({
          data: windows.map((w) => ({ ...w, agentId })),
          skipDuplicates: true,
        }),
      ]);

      const fresh = await this.prisma.weeklyAvailability.findMany({
        where: { agentId },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      });

      return fresh.map((r) => weeklyAvailabilitySchema.parse(r));
    } catch (e) {
      this.handlePrismaError(e, 'upsertAvailability');
    }
  }

  async deleteAvailability(
    agentId: string,
    dto: DeleteWeeklyAvailabilityDto,
    userId: string,
  ): Promise<{ count: number }> {
    await this.assertAgentOwned(agentId, userId);

    const input = this.safeParse(
      deleteWeeklyAvailabilitySchema,
      dto,
      'Invalid delete availability payload',
    );

    try {
      if (input.mode === 'all') {
        const res = await this.prisma.weeklyAvailability.deleteMany({ where: { agentId } });
        return { count: res.count };
      }

      if (input.mode === 'byDay') {
        const res = await this.prisma.weeklyAvailability.deleteMany({
          where: { agentId, dayOfWeek: input.dayOfWeek },
        });
        return { count: res.count };
      }

      const { dayOfWeek, startTime, endTime } = input;
      if (!this.isStartBeforeEnd(startTime, endTime)) {
        throw new BadRequestException('endTime must be after startTime');
      }

      const res = await this.prisma.weeklyAvailability.deleteMany({
        where: {
          agentId,
          dayOfWeek,
          startTime: { lt: endTime },
          endTime: { gt: startTime },
        },
      });
      return { count: res.count };
    } catch (e) {
      this.handlePrismaError(e, 'deleteAvailability');
    }
  }

  // ---------- Agent ↔ CalendarConnection (Single assignment) ----------

  /**
   * Assign a single calendar connection to an agent.
   * Replaces any existing assignment atomically (idempotent).
   */
  async assignCalendarToAgent(
    agentId: string,
    calendarConnectionId: string,
    userId: string,
  ): Promise<{ agentId: string; calendarConnectionId: string }> {
    await this.assertAgentOwned(agentId, userId);

    if (!calendarConnectionId) {
      throw new BadRequestException('calendarConnectionId is required');
    }

    // Verify the connection belongs to this user
    const conn = await this.prisma.calendarConnection.findFirst({
      where: { id: calendarConnectionId, userId },
      select: { id: true },
    });
    if (!conn) {
      throw new NotFoundException('calendarConnectionId not found for this user');
    }

    try {
      await this.prisma.$transaction([
        // ensure single assignment per agent
        this.prisma.agentCalendarAssignment.deleteMany({ where: { agentId } }),
        this.prisma.agentCalendarAssignment.create({
          data: { agentId, calendarConnectionId },
        }),
      ]);

      return { agentId, calendarConnectionId };
    } catch (e) {
      this.handlePrismaError(e, 'assignCalendarToAgent');
    }
  }

  /**
   * Get the (single) calendar currently assigned to an agent, if any.
   */
  async getAgentCalendar(
    agentId: string,
    userId: string,
  ): Promise<{ calendarConnectionId: string; assignedAt: Date } | null> {
    await this.assertAgentOwned(agentId, userId);
    try {
      const row = await this.prisma.agentCalendarAssignment.findFirst({
        where: { agentId },
        select: { calendarConnectionId: true, assignedAt: true },
        orderBy: { assignedAt: 'asc' },
      });
      return row ?? null;
    } catch (e) {
      this.handlePrismaError(e, 'getAgentCalendar');
    }
  }

  /**
   * Unassign the calendar (if any) from an agent.
   */
  async unassignCalendarFromAgent(
    agentId: string,
    userId: string,
  ): Promise<{ removed: boolean }> {
    await this.assertAgentOwned(agentId, userId);
    try {
      const res = await this.prisma.agentCalendarAssignment.deleteMany({ where: { agentId } });
      return { removed: res.count > 0 };
    } catch (e) {
      this.handlePrismaError(e, 'unassignCalendarFromAgent');
    }
  }

  // ---------- Backward-compat wrappers (optional) ----------

  /**
   * DEPRECATED: multi-assign wrapper. Accepts exactly one id for backward compatibility.
   */
  async assignCalendarsToAgent(
    agentId: string,
    connectionIds: string[],
    userId: string,
  ): Promise<{ agentId: string; assignedConnectionIds: string[] }> {
    if (!Array.isArray(connectionIds) || connectionIds.length !== 1) {
      throw new BadRequestException(
        'Only one calendarConnectionId is allowed. Pass a single id in the array.',
      );
    }
    const { calendarConnectionId } = await this.assignCalendarToAgent(
      agentId,
      connectionIds[0],
      userId,
    );
    return { agentId, assignedConnectionIds: [calendarConnectionId] };
  }

  /**
   * DEPRECATED: list wrapper. Returns [] or [one].
   */
  async listAgentCalendars(
    agentId: string,
    userId: string,
  ): Promise<Array<{ calendarConnectionId: string; assignedAt: Date }>> {
    const one = await this.getAgentCalendar(agentId, userId);
    return one ? [one] : [];
  }

  /**
   * DEPRECATED: unassign wrapper. Returns removed ids array.
   */
  async unassignCalendarsFromAgent(
    agentId: string,
    connectionIds: string[],
    userId: string,
  ): Promise<{ removed: string[] }> {
    // Ignore requested ids; we only keep a single assignment anyway.
    const current = await this.prisma.agentCalendarAssignment.findFirst({
      where: { agentId },
      select: { calendarConnectionId: true },
    });
    const { removed } = await this.unassignCalendarFromAgent(agentId, userId);
    return { removed: removed && current ? [current.calendarConnectionId] : [] };
  }

  // ---------- Helpers ----------

  private async assertAgentOwned(agentId: string, userId: string): Promise<void> {
    const agent = await this.prisma.agent.findFirst({ where: { id: agentId, userId } });
    if (!agent) throw new NotFoundException('Agent not found or not owned by user');
  }

  private toMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }

  private isStartBeforeEnd(start: string, end: string): boolean {
    return this.toMinutes(end) > this.toMinutes(start);
  }

  private assertNoOverlapsAndAligned(
    windows: { dayOfWeek: any; startTime: string; endTime: string }[],
    slot?: number,
  ) {
    const byDay = new Map<string, { start: number; end: number; raw: string[] }[]>();

    for (const w of windows) {
      const start = this.toMinutes(w.startTime);
      const end = this.toMinutes(w.endTime);

      if (end <= start) {
        throw new BadRequestException(
          `Invalid range ${w.startTime}-${w.endTime} (${String(w.dayOfWeek)})`,
        );
      }

      if (slot && ((start % slot) !== 0 || (end % slot) !== 0)) {
        throw new BadRequestException(
          `Times must align with slot (${slot}m): ${w.startTime}-${w.endTime} (${String(
            w.dayOfWeek,
          )})`,
        );
      }

      const key = String(w.dayOfWeek);
      const arr = byDay.get(key) ?? [];
      arr.push({ start, end, raw: [w.startTime, w.endTime] });
      byDay.set(key, arr);
    }

    for (const [day, arr] of byDay.entries()) {
      arr.sort((a, b) => a.start - b.start);
      for (let i = 1; i < arr.length; i++) {
        const prev = arr[i - 1];
        const curr = arr[i];
        if (curr.start < prev.end) {
          throw new ConflictException(
            `Overlapping windows on ${day}: ${prev.raw.join('-')} and ${curr.raw.join('-')}`,
          );
        }
      }
    }
  }

  private safeParse<T extends z.ZodTypeAny, O = z.infer<T>>(
    schema: T,
    payload: unknown,
    message = 'Validation failed',
  ): O {
    try {
      return schema.parse(payload) as O;
    } catch (e) {
      if (e instanceof ZodError) {
        throw new BadRequestException({
          message,
          issues: e.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
            code: i.code,
          })),
        });
      }
      throw e;
    }
  }

  private handlePrismaError(e: unknown, context: string): never {
    if (e instanceof PrismaClientKnownRequestError) {
      switch (e.code) {
        case 'P2002':
          throw new ConflictException('Unique constraint violated');
        case 'P2003':
          throw new BadRequestException('Invalid reference');
        case 'P2025':
          throw new NotFoundException('Resource not found');
        default:
          this.logger.error(`[${context}] Prisma error ${e.code}: ${e.message}`);
          throw new InternalServerErrorException('Database error');
      }
    }

    if (e instanceof Prisma.PrismaClientValidationError) {
      this.logger.warn(`[${context}] Prisma validation error: ${e.message}`);
      throw new BadRequestException('Invalid data for database operation');
    }

    this.handleUnknownError(e, context);
  }

  private handleUnknownError(e: unknown, context: string): never {
    this.logger.error(`[${context}] Unexpected error`, e as any);
    throw new InternalServerErrorException('Unexpected server error');
  }
}
