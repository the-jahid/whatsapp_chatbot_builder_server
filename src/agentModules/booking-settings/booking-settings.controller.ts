// src/agentModules/booking-settings/booking-settings.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Post,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { BookingSettingsService } from './booking-settings.service';
import { UpsertBookingSettingsDto } from './dto/upsert-booking-settings.dto';
import { PatchBookingSettingsDto } from './dto/patch-booking-settings.dto';
import { UpsertWeeklyAvailabilityDto } from './dto/upsert-weekly-availability.dto';
import { DeleteWeeklyAvailabilityDto } from './dto/delete-weekly-availability.dto';

import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { UserService } from 'src/user/services/user.service';

// import { AuthGuard } from '../../auth/auth.guard';
// import { User } from '../../auth/user.decorator';

type AssignCalendarBody = { calendarConnectionId: string };

// augment Request to include Clerk auth payload we expect
type ReqWithAuth = Request & {
  auth?: {
    clerkUserId?: string;
    sessionId?: string;
  };
};

@UseGuards(ClerkAuthGuard)
@Controller('agents/:agentId/booking')
export class BookingSettingsController {
  private readonly logger = new Logger(BookingSettingsController.name);

  constructor(
    private readonly booking: BookingSettingsService,
    private readonly userService: UserService,
  ) { }

  // ---------- Booking Settings ----------

  @Get('settings')
  async getSettings(
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @Req() req: ReqWithAuth,
  ) {
    try {
      const me = await this.userService.getFromAuth(req.auth ?? {});
      return await this.booking.getSettings(agentId, me.id);
    } catch (e) {
      this.handleError(e, 'getSettings');
    }
  }

  @Put('settings')
  async upsertSettings(
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @Body() dto: UpsertBookingSettingsDto,
    @Req() req: ReqWithAuth,
  ) {
    try {
      const me = await this.userService.getFromAuth(req.auth ?? {});
      return await this.booking.upsertSettings(agentId, dto, me.id);
    } catch (e) {
      this.handleError(e, 'upsertSettings');
    }
  }

  @Patch('settings')
  async patchSettings(
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @Body() dto: PatchBookingSettingsDto,
    @Req() req: ReqWithAuth,
  ) {
    try {
      const me = await this.userService.getFromAuth(req.auth ?? {});
      return await this.booking.patchSettings(agentId, dto, me.id);
    } catch (e) {
      this.handleError(e, 'patchSettings');
    }
  }

  @Delete('settings')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSettings(
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @Req() req: ReqWithAuth,
  ) {
    try {
      const me = await this.userService.getFromAuth(req.auth ?? {});
      await this.booking.deleteSettings(agentId, me.id);
    } catch (e) {
      this.handleError(e, 'deleteSettings');
    }
  }

  // ---------- Weekly Availability ----------

  @Get('availability')
  async getAvailability(
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @Req() req: ReqWithAuth,
  ) {
    try {
      const me = await this.userService.getFromAuth(req.auth ?? {});
      return await this.booking.getAvailability(agentId, me.id);
    } catch (e) {
      this.handleError(e, 'getAvailability');
    }
  }

  @Put('availability')
  async upsertAvailability(
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @Body() dto: UpsertWeeklyAvailabilityDto,
    @Req() req: ReqWithAuth,
  ) {
    try {
      const me = await this.userService.getFromAuth(req.auth ?? {});
      return await this.booking.upsertAvailability(agentId, dto, me.id);
    } catch (e) {
      this.handleError(e, 'upsertAvailability');
    }
  }

  @Delete('availability')
  @HttpCode(HttpStatus.OK)
  async deleteAvailability(
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @Body() dto: DeleteWeeklyAvailabilityDto,
    @Req() req: ReqWithAuth,
  ) {
    try {
      const me = await this.userService.getFromAuth(req.auth ?? {});
      return await this.booking.deleteAvailability(agentId, dto, me.id);
    } catch (e) {
      this.handleError(e, 'deleteAvailability');
    }
  }

  // ---------- Calendar Assignment (single) ----------

  /** Get the single calendar currently assigned to the agent (or null) */
  @Get('calendar')
  async getAssignedCalendar(
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @Req() req: ReqWithAuth,
  ) {
    try {
      const me = await this.userService.getFromAuth(req.auth ?? {});
      return await this.booking.getAgentCalendar(agentId, me.id);
    } catch (e) {
      this.handleError(e, 'getAssignedCalendar');
    }
  }

  /** Assign a single calendar connection to the agent (replaces any existing one) */
  @Post('calendar/assign')
  async assignCalendar(
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @Body() body: AssignCalendarBody,
    @Req() req: ReqWithAuth,
  ) {
    try {
      const me = await this.userService.getFromAuth(req.auth ?? {});
      const { calendarConnectionId } = body || ({} as AssignCalendarBody);
      if (!calendarConnectionId) {
        throw new BadRequestException('calendarConnectionId is required');
      }
      return await this.booking.assignCalendarToAgent(agentId, calendarConnectionId, me.id);
    } catch (e) {
      this.handleError(e, 'assignCalendar');
    }
  }

  /** Unassign the current calendar from the agent */
  @Delete('calendar/assign')
  @HttpCode(HttpStatus.OK)
  async unassignCalendar(
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @Req() req: ReqWithAuth,
  ) {
    try {
      const me = await this.userService.getFromAuth(req.auth ?? {});
      return await this.booking.unassignCalendarFromAgent(agentId, me.id);
    } catch (e) {
      this.handleError(e, 'unassignCalendar');
    }
  }

  // ---------- Error mapping (controller-level) ----------

  private handleError(err: unknown, context: string): never {
    if (err instanceof HttpException) throw err;

    if (err instanceof ZodError) {
      throw new BadRequestException({
        message: 'Validation failed',
        context,
        errors: err.issues.map((i) => ({
          path: i.path.join('.'),
          code: i.code,
          message: i.message,
        })),
      });
    }

    if (err instanceof PrismaClientKnownRequestError) {
      switch (err.code) {
        case 'P2002':
          throw new ConflictException({ message: 'Unique constraint violated', context });
        case 'P2003':
          throw new BadRequestException({ message: 'Invalid reference', context });
        case 'P2025':
          throw new NotFoundException({ message: 'Resource not found', context });
        default:
          this.logger.error(`[${context}] Prisma error ${err.code}: ${err.message}`);
          throw new InternalServerErrorException({ message: 'Database error', context });
      }
    }

    if (err instanceof Prisma.PrismaClientValidationError) {
      throw new BadRequestException({ message: 'Invalid data for database operation', context });
    }

    this.logger.error(`[${context}] Unexpected error`, err as any);
    throw new InternalServerErrorException({ message: 'Unexpected server error', context });
  }
}
