import {
  Injectable,
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  InternalServerErrorException,
} from '@nestjs/common';
import { OutboundTemplateRepository } from './repository/outbound-template.repository';
import type { CreateTemplateDto } from './dto/create-template.dto';
import type { UpdateTemplateDto } from './dto/update-template.dto';
import type { QueryTemplatesDto } from './dto/query-templates.dto';
import {
  CreateTemplateBodySchema,
  UpdateTemplateBodySchema,
  QueryTemplatesSchema,
  UUID_ANY,
} from './schema/template.schema';
import type { TemplateMediaPayload, TemplatePublic } from './interface/template.interface';

/** ============================================================
 * Local structural type for an uploaded file (avoids Express.Multer typings)
 * ============================================================ */
export type UploadedFile = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

/** Optional dep to detect image dimensions (safe if missing) */
let imageSize:
  | ((input: Buffer) => { width?: number | undefined; height?: number | undefined })
  | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const size = require('image-size');
  imageSize = (buf: Buffer) => size.imageSize(buf);
} catch {
  imageSize = null; // if not installed, we just skip width/height
}

/** Size limits (tune as needed) */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20MB
const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100MB
const MAX_DOC_BYTES = 25 * 1024 * 1024;   // 25MB (e.g., PDFs)

function parseOrThrow<T>(schema: any, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new BadRequestException(msg);
  }
  return parsed.data;
}

@Injectable()
export class OutboundTemplateService {
  constructor(private readonly repo: OutboundTemplateRepository) {}

  /* ------------ Helpers ------------ */

  private validateId(id: string) {
    parseOrThrow(UUID_ANY, id);
  }

  private buildMediaPayload(file?: UploadedFile | null): TemplateMediaPayload | null {
    if (!file) return null;

    if (!file.mimetype) {
      throw new UnsupportedMediaTypeException('Missing file mimetype');
    }

    const isImage = file.mimetype.startsWith('image/');
    const isVideo = file.mimetype.startsWith('video/');
    const isDocument = file.mimetype === 'application/pdf' || file.mimetype.startsWith('application/');

    if (!isImage && !isVideo && !isDocument) {
      throw new UnsupportedMediaTypeException('Only image/*, video/*, or application/* documents are allowed');
    }

    if (isImage && file.size > MAX_IMAGE_BYTES) {
      throw new PayloadTooLargeException(`Image exceeds ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB`);
    }
    if (isVideo && file.size > MAX_VIDEO_BYTES) {
      throw new PayloadTooLargeException(`Video exceeds ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)}MB`);
    }
    if (isDocument && file.size > MAX_DOC_BYTES) {
      throw new PayloadTooLargeException(`Document exceeds ${Math.round(MAX_DOC_BYTES / 1024 / 1024)}MB`);
    }

    let width: number | null = null;
    let height: number | null = null;
    if (isImage && imageSize) {
      try {
        const dim = imageSize(file.buffer);
        width = dim.width ?? null;
        height = dim.height ?? null;
      } catch {
        width = null;
        height = null;
      }
    }

    return {
      buffer: file.buffer,
      mimetype: file.mimetype,
      originalname: file.originalname,
      size: file.size,
      width,
      height,
      // mediaType inferred by repository via mimetype
    };
  }

  /* ------------ CRUD ------------ */

  /**
   * Create a template. `mediaFile` is optional (image/video/document).
   * Defaults body to "Hello world" when omitted.
   */
  async create(body: CreateTemplateDto, mediaFile?: UploadedFile): Promise<TemplatePublic> {
    const dto = parseOrThrow<CreateTemplateDto>(CreateTemplateBodySchema, body);
    const media = this.buildMediaPayload(mediaFile);

    try {
      return await this.repo.create(
        {
          agentId: dto.agentId,
          name: dto.name,
          body: dto.body,
          variables: dto.variables,
        },
        media,
      );
    } catch (err: any) {
      if (err?.code === 'P2002') {
        // unique constraint (agentId, name)
        throw new BadRequestException('A template with the same name already exists for this agent.');
      }
      throw new InternalServerErrorException(err?.message || 'Failed to create template');
    }
  }

  /** Update non-media fields */
  async update(id: string, body: UpdateTemplateDto): Promise<TemplatePublic> {
    this.validateId(id);
    const dto = parseOrThrow<UpdateTemplateDto>(UpdateTemplateBodySchema, body);

    try {
      return await this.repo.update(id, dto);
    } catch (err: any) {
      if (err?.status === 404 || err?.name === 'NotFoundException') {
        throw new NotFoundException('Template not found');
      }
      if (err?.code === 'P2002') {
        throw new BadRequestException('A template with the same name already exists for this agent.');
      }
      throw new InternalServerErrorException(err?.message || 'Failed to update template');
    }
  }

  /** Replace media buffer (image/video/document) */
  async replaceMedia(id: string, mediaFile?: UploadedFile): Promise<TemplatePublic> {
    this.validateId(id);
    if (!mediaFile) throw new BadRequestException('media file is required');

    const media = this.buildMediaPayload(mediaFile);
    try {
      return await this.repo.replaceMedia(id, media!);
    } catch (err: any) {
      if (err?.status === 404 || err?.name === 'NotFoundException') {
        throw new NotFoundException('Template not found');
      }
      throw new InternalServerErrorException(err?.message || 'Failed to replace media');
    }
  }

  /** Remove media and reset fields */
  async clearMedia(id: string): Promise<TemplatePublic> {
    this.validateId(id);
    try {
      return await this.repo.clearMedia(id);
    } catch (err: any) {
      if (err?.status === 404 || err?.name === 'NotFoundException') {
        throw new NotFoundException('Template not found');
      }
      throw new InternalServerErrorException(err?.message || 'Failed to clear media');
    }
  }

  /** Public (non-binary) read */
  async get(id: string): Promise<TemplatePublic> {
    this.validateId(id);
    try {
      return await this.repo.getPublic(id);
    } catch (err: any) {
      if (err?.status === 404 || err?.name === 'NotFoundException') {
        throw new NotFoundException('Template not found');
      }
      throw new InternalServerErrorException(err?.message || 'Failed to fetch template');
    }
  }

  /**
   * Raw media fetch for controllers to stream the binary.
   * Returns { buffer, mimeType, fileName } or throws 404.
   */
  async getMediaBinary(id: string): Promise<{ buffer: Buffer; mimeType: string; fileName: string | null }> {
    this.validateId(id);
    const t = await this.repo.getRaw(id);
    if (!t) throw new NotFoundException('Template not found');
    if (!t.mediaData || !t.mediaMimeType) throw new NotFoundException('Media not found');

    return {
      buffer: Buffer.from(t.mediaData as unknown as Uint8Array),
      mimeType: t.mediaMimeType,
      fileName: t.mediaFileName ?? null,
    };
  }

  /** Paginated list + total count */
  async list(query: QueryTemplatesDto): Promise<{ items: TemplatePublic[]; total: number; skip: number; take: number }> {
    const q = parseOrThrow<QueryTemplatesDto>(QueryTemplatesSchema, query);
    try {
      const [items, total] = await Promise.all([this.repo.list(q), this.repo.count(q)]);
      return {
        items,
        total,
        skip: q.skip ?? 0,
        take: q.take ?? 50,
      };
    } catch (err: any) {
      throw new InternalServerErrorException(err?.message || 'Failed to list templates');
    }
  }

  /** Delete template */
  async delete(id: string): Promise<void> {
    this.validateId(id);
    try {
      await this.repo.delete(id);
    } catch (err: any) {
      if (err?.code === 'P2025' || err?.status === 404) {
        throw new NotFoundException('Template not found');
      }
      throw new InternalServerErrorException(err?.message || 'Failed to delete template');
    }
  }
}
