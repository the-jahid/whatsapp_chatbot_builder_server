import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, TemplateMediaType } from '@prisma/client';
import * as crypto from 'crypto';

import {
  ListTemplatesFilter,
  TemplateMediaPayload,
  TemplatePublic,
} from '../interface/template.interface';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class OutboundTemplateRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Hide heavy/binary fields for API responses */
  toPublic(t: any): TemplatePublic {
    const { mediaData, mediaChecksum, ...rest } = t;
    return { ...rest, hasMedia: !!mediaData };
  }

  /** Resolve media type from mimetype if not explicitly provided */
  private inferTypeFromMime(mime?: string): TemplateMediaType {
    if (!mime) throw new BadRequestException('Missing mimetype');
    if (mime.startsWith('image/')) return TemplateMediaType.IMAGE;
    if (mime.startsWith('video/')) return TemplateMediaType.VIDEO;
    if (mime === 'application/pdf' || mime.startsWith('application/')) return TemplateMediaType.DOCUMENT;
    throw new BadRequestException('Only image/*, video/*, or application/* documents are allowed');
  }

  /** Build media patch for Prisma create/update */
  private buildMediaPatch(media: TemplateMediaPayload | null | undefined) {
    if (!media) return { mediaType: TemplateMediaType.NONE as TemplateMediaType };

    const mediaType: TemplateMediaType =
      (media.mediaType as TemplateMediaType) ?? this.inferTypeFromMime(media.mimetype);

    const checksum =
      media.checksum ?? crypto.createHash('md5').update(media.buffer).digest('hex');

    return {
      mediaType,
      mediaData: media.buffer,
      mediaMimeType: media.mimetype,
      mediaFileName: media.originalname,
      mediaSize: media.size,
      mediaWidth: media.width ?? null,
      mediaHeight: media.height ?? null,
      mediaChecksum: checksum,
    };
  }

  /** Create template (media optional). Unchecked create via agentId to reduce type friction. */
  async create(
    data: {
      agentId: string;
      name: string;
      body?: string;
      variables?: string[];
    },
    media?: TemplateMediaPayload | null,
  ) {
    const base = {
      agentId: data.agentId,
      name: data.name,
      body: data.body ?? 'Hello world',
      variables: data.variables ?? [],
    };

    const mediaPatch = this.buildMediaPatch(media);

    const created = await this.prisma.template.create({
      data: { ...(base as any), ...(mediaPatch as any) },
    });

    return this.toPublic(created);
  }

  /** Update non-media fields */
  async update(
    id: string,
    data: Partial<{
      name: string;
      body: string;
      variables: string[];
    }>,
  ) {
    const exists = await this.prisma.template.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Template not found');

    const patch: Prisma.TemplateUpdateInput = {};
    if (data.name !== undefined) (patch as any).name = data.name;
    if (data.body !== undefined) (patch as any).body = data.body;
    if (data.variables !== undefined) (patch as any).variables = data.variables;

    const updated = await this.prisma.template.update({
      where: { id },
      data: patch,
    });
    return this.toPublic(updated);
  }

  /** Replace media buffer */
  async replaceMedia(id: string, media: TemplateMediaPayload) {
    const exists = await this.prisma.template.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Template not found');

    const patch = this.buildMediaPatch(media);
    const updated = await this.prisma.template.update({
      where: { id },
      data: patch as any,
    });
    return this.toPublic(updated);
  }

  /** Remove media and reset fields */
  async clearMedia(id: string) {
    const exists = await this.prisma.template.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Template not found');

    const updated = await this.prisma.template.update({
      where: { id },
      data: {
        mediaType: TemplateMediaType.NONE,
        mediaData: null,
        mediaMimeType: null,
        mediaFileName: null,
        mediaSize: null,
        mediaWidth: null,
        mediaHeight: null,
        mediaChecksum: null,
      } as any,
    });
    return this.toPublic(updated);
  }

  /** Public read (hides binary) */
  async getPublic(id: string) {
    const t = await this.prisma.template.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Template not found');
    return this.toPublic(t);
  }

  /** Raw read (includes mediaData) */
  getRaw(id: string) {
    return this.prisma.template.findUnique({ where: { id } });
  }

  /** List with filters (no more status/locale/flags) */
  async list(filter: ListTemplatesFilter): Promise<TemplatePublic[]> {
    const where: Prisma.TemplateWhereInput = {
      agentId: filter.agentId,
      ...(filter.q
        ? {
            OR: [
              { name: { contains: filter.q, mode: 'insensitive' } },
              { body: { contains: filter.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const orderBy: Prisma.TemplateOrderByWithRelationInput =
      filter.orderBy === 'name'
        ? { name: filter.orderDir ?? 'asc' }
        : { [filter.orderBy ?? 'createdAt']: filter.orderDir ?? 'desc' };

    const rows = await this.prisma.template.findMany({
      where,
      orderBy,
      skip: filter.skip ?? 0,
      take: filter.take ?? 50,
    });

    return rows.map((r) => this.toPublic(r));
  }

  count(filter: ListTemplatesFilter) {
    const where: Prisma.TemplateWhereInput = {
      agentId: filter.agentId,
      ...(filter.q
        ? {
            OR: [
              { name: { contains: filter.q, mode: 'insensitive' } },
              { body: { contains: filter.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return this.prisma.template.count({ where });
  }

  delete(id: string) {
    return this.prisma.template.delete({ where: { id } });
  }

  findByAgentAndName(agentId: string, name: string) {
    return this.prisma.template.findFirst({ where: { agentId, name } });
  }
}
