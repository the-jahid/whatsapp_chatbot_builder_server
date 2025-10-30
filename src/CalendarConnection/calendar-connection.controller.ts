import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { CalendarConnectionService } from './calendar-connection.service';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { UserService } from 'src/user/services/user.service';

import {
  createCalendarConnectionSchema,
  updateCalendarConnectionSchema,
} from './schema/calendar-connection.schema';
import type {
  CreateCalendarConnectionDto,
  UpdateCalendarConnectionDto,
} from './dto/calendar-connection.dto';
import { ZodError, z } from 'zod';

@UseGuards(ClerkAuthGuard)
@Controller('calendar-connections')
export class CalendarConnectionController {
  constructor(
    private readonly connectionService: CalendarConnectionService,
    private readonly userService: UserService,
  ) {}

  // ---------- helpers: validation ----------
  private parseOrBadRequest<T>(schema: { parse: (v: unknown) => T }, payload: unknown): T {
    try {
      return schema.parse(payload);
    } catch (e) {
      if (e instanceof ZodError) {
        throw new BadRequestException({
          message: 'Validation failed',
          errors: e.issues.map((i) => ({
            path: i.path.join('.'),
            code: i.code,
            message: i.message,
          })),
        });
      }
      throw e;
    }
  }

  // Query validation for pagination
  private static listQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  });

  private parseListQuery(query: any) {
    return this.parseOrBadRequest(CalendarConnectionController.listQuerySchema, query);
  }

  // ---------- helpers: response envelope ----------
  private toSafe<T extends Record<string, any>>(conn: T) {
    const { accessToken, refreshToken, ...safe } = conn ?? {};
    return safe;
  }

  private baseUrl(req: Request) {
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
    const host = req.get('host');
    return `${proto}://${host}`;
  }

  private pageLinks(req: Request, page: number, pageSize: number, totalPages: number) {
    const makeUrl = (p: number) => {
      const url = new URL(req.originalUrl, this.baseUrl(req));
      url.searchParams.set('page', String(p));
      url.searchParams.set('pageSize', String(pageSize));
      return url.pathname + (url.search ? url.search : '');
    };
    return {
      self: makeUrl(page),
      first: makeUrl(1),
      prev: page > 1 ? makeUrl(page - 1) : null,
      next: page < totalPages ? makeUrl(page + 1) : null,
      last: makeUrl(totalPages),
    };
  }

  private okList<T>(req: Request, items: T[], page: number, pageSize: number, total: number) {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return {
      data: items,
      meta: {
        pagination: { page, pageSize, total, totalPages },
      },
      links: this.pageLinks(req, page, pageSize, totalPages),
      http: { status: 200 },
    };
  }

  private okItem<T>(req: Request, item: T) {
    const url = new URL(req.originalUrl, this.baseUrl(req));
    return {
      data: item,
      links: { self: url.pathname + (url.search ? url.search : '') },
      http: { status: 200 },
    };
  }

  private createdItem<T>(req: Request, item: T) {
    const url = new URL(req.originalUrl, this.baseUrl(req));
    return {
      data: item,
      links: { self: url.pathname + (url.search ? url.search : '') },
      http: { status: 201 },
    };
  }

  // ---------- endpoints ----------

  /**
   * GET /calendar-connections
   * Paginated list for the authenticated user (safe data).
   * Query: ?page=1&pageSize=20
   */
  @Get()
  async findAll(@Req() req: Request) {
    const me = await this.userService.getFromAuth((req as any).auth ?? {});
    const { page, pageSize } = this.parseListQuery(req.query);

    // use paged service for efficiency
    const { items, total } = await this.connectionService.findAllByUserIdPaged(
      me.id,
      page,
      pageSize,
    );

    const safe = items.map((c) => this.toSafe(c));
    return this.okList(req, safe, page, pageSize, total);
  }

  /**
   * GET /calendar-connections/:id
   * Retrieves a single calendar connection (safe).
   */
  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const me = await this.userService.getFromAuth((req as any).auth ?? {});
    const connection = await this.connectionService.findOne(id, me.id);
    return this.okItem(req, this.toSafe(connection));
  }

  /**
   * POST /calendar-connections
   * Creates a calendar connection for the authenticated user.
   */
  @Post()
  async create(@Body() body: unknown, @Req() req: Request) {
    const me = await this.userService.getFromAuth((req as any).auth ?? {});
    const payload = this.parseOrBadRequest<CreateCalendarConnectionDto>(
      createCalendarConnectionSchema,
      body,
    );
    const created = await this.connectionService.createForUser(me.id, payload);
    return this.createdItem(req, this.toSafe(created));
  }

  /**
   * PATCH /calendar-connections/:id
   * Updates a calendar connection (e.g., set as primary).
   */
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const me = await this.userService.getFromAuth((req as any).auth ?? {});
    const updates = this.parseOrBadRequest<UpdateCalendarConnectionDto>(
      updateCalendarConnectionSchema,
      body,
    );
    const updated = await this.connectionService.update(id, updates, me.id);
    return this.okItem(req, this.toSafe(updated));
  }

  /**
   * DELETE /calendar-connections/:id
   * Deletes a calendar connection.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const me = await this.userService.getFromAuth((req as any).auth ?? {});
    await this.connectionService.remove(id, me.id);
    // 204: no response body by design
  }
}
