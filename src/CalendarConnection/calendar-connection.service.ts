import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  ServiceUnavailableException,
  HttpException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCalendarConnectionDto,
  UpdateCalendarConnectionDto,
} from './dto/calendar-connection.dto';
import type { ExternalCalendarConnection } from './interface/calendar-connection.interface';
import {
  createCalendarConnectionSchema,
  updateCalendarConnectionSchema,
} from './schema/calendar-connection.schema';
import { ZodError, z } from 'zod'; // ⬅️ include z
import * as crypto from 'crypto';

@Injectable()
export class CalendarConnectionService {
  constructor(private prisma: PrismaService) {}

  // === Internal schema for create() that expects userId ===
  // (Controllers should use createForUser() instead, but create() is supported too.)
  private readonly createWithUserIdSchema = createCalendarConnectionSchema.extend({
    userId: z.string().uuid({ message: 'userId must be a valid UUID' }),
  });

  // ========= Encryption (optional) =========
  private get encKey(): Buffer | null {
    const b64 = process.env.CALENDAR_TOKENS_KEY;
    if (!b64) return null; // store plain in dev if unset
    try {
      const buf = Buffer.from(b64, 'base64');
      if (buf.length !== 32) {
        throw new InternalServerErrorException(
          'CALENDAR_TOKENS_KEY must be a base64-encoded 32-byte key.',
        );
      }
      return buf;
    } catch {
      throw new InternalServerErrorException(
        'CALENDAR_TOKENS_KEY is not valid base64 (expected 32 bytes).',
      );
    }
  }

  private encrypt(plain?: string | null): string | null {
    if (!plain) return null;
    if (!this.encKey) return plain; // dev fallback
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]).toString('base64'); // [iv(12) | tag(16) | data]
  }

  // ========= Mappers =========
  private toExternal(conn: any): ExternalCalendarConnection {
    return {
      id: conn.id,
      provider: conn.provider,
      accountEmail: conn.accountEmail,
      accessTokenExpiresAt: conn.accessTokenExpiresAt,
      calendarId: conn.calendarId,
      isPrimary: conn.isPrimary,
      createdAt: conn.createdAt,
      updatedAt: conn.updatedAt,
      userId: conn.userId,
    };
  }

  // ========= Error handling =========
  private throwZod(err: ZodError): never {
    const errors = err.issues.map((i) => ({
      path: i.path.join('.'),
      code: i.code,
      message: i.message,
    }));
    throw new BadRequestException({ message: 'Validation failed', errors });
  }

  private handlePrismaKnown(err: Prisma.PrismaClientKnownRequestError): never {
    switch (err.code) {
      case 'P2002': {
        const target = (err.meta as any)?.target;
        throw new ConflictException({ message: 'Unique constraint failed', target });
      }
      case 'P2003': {
        throw new BadRequestException('Invalid reference: related record does not exist.');
      }
      case 'P2025': {
        throw new NotFoundException('Resource not found.');
      }
      default:
        throw new InternalServerErrorException('Database error.');
    }
  }

  private rethrow(err: unknown, context = 'Calendar connection operation'): never {
    if (err instanceof HttpException) throw err;
    if (err instanceof ZodError) this.throwZod(err);
    if (err instanceof Prisma.PrismaClientKnownRequestError) this.handlePrismaKnown(err);
    if (err instanceof Prisma.PrismaClientValidationError) {
      throw new BadRequestException('Invalid data for database operation.');
    }
    if (err instanceof Prisma.PrismaClientInitializationError) {
      throw new ServiceUnavailableException('Database is not available.');
    }
    if (err instanceof Error) {
      throw new InternalServerErrorException(`${context}: ${err.message}`);
    }
    throw new InternalServerErrorException(context);
  }

  // ========= CREATE =========
  /**
   * WARNING: Prefer createForUser(userId, dto) so userId comes from auth.
   * This method supports a payload containing userId (validated).
   */
  async create(createDto: CreateCalendarConnectionDto & { userId: string }) {
    try {
      const payload = this.createWithUserIdSchema.parse(createDto);

      const data = {
        ...payload,
        accountEmail: payload.accountEmail.trim().toLowerCase(),
        accessToken: this.encrypt(payload.accessToken),
        refreshToken: this.encrypt(payload.refreshToken),
      };

      if (payload.isPrimary) {
        return await this.prisma.$transaction(async (tx) => {
          await tx.calendarConnection.updateMany({
            where: { userId: payload.userId },
            data: { isPrimary: false },
          });
          return tx.calendarConnection.create({ data });
        });
      }

      return await this.prisma.calendarConnection.create({ data });
    } catch (err) {
      this.rethrow(err, 'Creating calendar connection');
    }
  }

  /**
   * Safer create: userId is injected from auth context.
   */
  async createForUser(userId: string, createDto: CreateCalendarConnectionDto) {
    try {
      if (!userId) throw new BadRequestException('userId is required.');
      const parsed = createCalendarConnectionSchema.parse(createDto);

      const data = {
        ...parsed,
        userId,
        accountEmail: parsed.accountEmail.trim().toLowerCase(),
        accessToken: this.encrypt(parsed.accessToken),
        refreshToken: this.encrypt(parsed.refreshToken),
      };

      if (parsed.isPrimary) {
        return await this.prisma.$transaction(async (tx) => {
          await tx.calendarConnection.updateMany({ where: { userId }, data: { isPrimary: false } });
          return tx.calendarConnection.create({ data });
        });
      }

      return await this.prisma.calendarConnection.create({ data });
    } catch (err) {
      this.rethrow(err, 'Creating calendar connection for user');
    }
  }

  // ========= READ (list) =========
  async findAllByUserId(userId: string): Promise<ExternalCalendarConnection[]> {
    try {
      if (!userId) throw new BadRequestException('userId is required.');
      const connections = await this.prisma.calendarConnection.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      return connections.map((c) => this.toExternal(c));
    } catch (err) {
      this.rethrow(err, 'Listing calendar connections');
    }
  }

  // ✅ NEW: Paged list for controller
  async findAllByUserIdPaged(userId: string, page = 1, pageSize = 20) {
    try {
      if (!userId) throw new BadRequestException('userId is required.');

      const skip = Math.max(0, (page - 1) * pageSize);
      const take = Math.max(1, pageSize);

      const [items, total] = await this.prisma.$transaction([
        this.prisma.calendarConnection.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        this.prisma.calendarConnection.count({ where: { userId } }),
      ]);

      return { items, total };
    } catch (err) {
      this.rethrow(err, 'Listing calendar connections (paged)');
    }
  }

  // ========= READ (one, internal) =========
  async findOne(id: string, userId: string) {
    try {
      if (!id) throw new BadRequestException('id is required.');
      if (!userId) throw new BadRequestException('userId is required.');
      const connection = await this.prisma.calendarConnection.findFirst({
        where: { id, userId },
      });
      if (!connection) {
        throw new NotFoundException(`Connection with ID ${id} not found.`);
      }
      return connection;
    } catch (err) {
      this.rethrow(err, 'Fetching calendar connection');
    }
  }

  // ========= UPDATE =========
  async update(id: string, updateDto: UpdateCalendarConnectionDto, userId: string) {
    try {
      if (!id) throw new BadRequestException('id is required.');
      if (!userId) throw new BadRequestException('userId is required.');

      // verify exists & ownership
      await this.findOne(id, userId);

      const updates = updateCalendarConnectionSchema.parse(updateDto);
      if (Object.keys(updates).length === 0) {
        throw new BadRequestException('No valid fields to update.');
      }

      if (updates.isPrimary === true) {
        return await this.prisma.$transaction(async (tx) => {
          await tx.calendarConnection.updateMany({ where: { userId }, data: { isPrimary: false } });
          return tx.calendarConnection.update({
            where: { id },
            data: { ...updates, isPrimary: true },
          });
        });
      }

      return await this.prisma.calendarConnection.update({
        where: { id },
        data: updates,
      });
    } catch (err) {
      this.rethrow(err, 'Updating calendar connection');
    }
  }

  // ========= DELETE =========
  async remove(id: string, userId: string) {
    try {
      if (!id) throw new BadRequestException('id is required.');
      if (!userId) throw new BadRequestException('userId is required.');

      const connection = await this.findOne(id, userId);

      // TODO: revoke tokens with provider using decrypted refresh token if you add decrypt()

      await this.prisma.calendarConnection.delete({
        where: { id: connection.id },
      });
    } catch (err) {
      this.rethrow(err, 'Deleting calendar connection');
    }
  }
}
