// src/knowledgebase/knowledgebase.controller.ts
import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { KnowledgebaseService } from './knowledgebase.service';

// Zod-backed DTO parsers
import {
  parseUpdateKnowledgeBase,
  parseCreateTextDocument,
  parseCreateFileDocumentMeta,
  parseListDocumentsQuery,
  parseKnowledgeSearch,
  parseDeleteDocumentQuery,
  parseReembedDocument,
} from './dto/knowledgebase.dto';

import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';

import type {
  KnowledgeBase,
  KnowledgeBaseDocument,
  KnowledgeSearchMatch,
  Paginated,
} from './interface/knowledgebase.interface';

/**
 * Base route:
 *   /agents/:agentId/knowledgebase
 *
 * Pinecone namespace = agentId
 */
// @UseGuards(ClerkAuthGuard)
@Controller('agents/:agentId/knowledgebase')
export class KnowledgebaseController {
  constructor(private readonly service: KnowledgebaseService) {}

  /* ----------------------- KnowledgeBase ----------------------- */

  /** Get KB (auto-creates if missing) */
  @Get()
  async getKB(@Param('agentId') agentId: string): Promise<KnowledgeBase> {
    return this.service.getKnowledgeBase(agentId);
  }

  /** Update KB defaults/metadata */
  @Patch()
  async updateKB(
    @Param('agentId') agentId: string,
    @Body() body: unknown
  ): Promise<KnowledgeBase> {
    const dto = parseUpdateKnowledgeBase(body);
    return this.service.updateKnowledgeBase(agentId, dto);
  }

  /* ----------------------- Documents: create ----------------------- */

  /** Create + chunk + embed + upsert a TEXT document */
  @Post('documents/text')
  async createText(
    @Param('agentId') agentId: string,
    @Body() body: unknown
  ): Promise<KnowledgeBaseDocument> {
    const dto = parseCreateTextDocument(body);
    return this.service.addTextDocument(agentId, dto);
  }

  /**
   * Create FILE document metadata row (no binary here).
   * After your upload/extraction pipeline finishes, call:
   *   POST /documents/:documentId/extraction
   */
  @Post('documents/file/meta')
  async createFileMeta(
    @Param('agentId') agentId: string,
    @Body() body: unknown
  ): Promise<KnowledgeBaseDocument> {
    const dto = parseCreateFileDocumentMeta(body);
    return this.service.addFileDocumentMeta(agentId, dto);
  }

  /**
   * One-shot upload + extract + embed + upsert (activates the document).
   * Send multipart/form-data with field "file". Additional options can be sent
   * as regular form fields (title is required).
   */
  @Post('documents/file')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAndEmbedFile(
    @Param('agentId') agentId: string,
    // Minimal, dependency-free typing to avoid Express.Multer types
    @UploadedFile()
    file: { buffer: Buffer; mimetype: string; originalname: string },
    @Body()
    body: {
      title?: string;
      tags?: string[] | string;
      checksum?: string;
      storagePath?: string;
      vectorIdPrefix?: string;
      embeddingModel?: string;
      embeddingDimensions?: number | string;
      chunkSize?: number | string;
      chunkOverlap?: number | string;
      // optional arbitrary JSON metadata (when sent as stringified JSON)
      metadata?: Record<string, unknown> | string;
    }
  ): Promise<KnowledgeBaseDocument> {
    if (!file) {
      throw new BadRequestException('file is required (multipart field "file")');
    }
    if (!body?.title?.trim()) {
      throw new BadRequestException('title is required');
    }

    // Normalize optional fields that may arrive as strings from multipart
    const toNum = (v: unknown) =>
      typeof v === 'string' && v.trim() !== '' ? Number(v) : (v as number | undefined);

    let metadata: Record<string, unknown> | undefined;
    if (body.metadata && typeof body.metadata === 'string') {
      try {
        metadata = JSON.parse(body.metadata);
      } catch {
        throw new BadRequestException('metadata must be valid JSON when sent as string');
      }
    } else if (body.metadata && typeof body.metadata === 'object') {
      metadata = body.metadata as Record<string, unknown>;
    }

    // Allow tags as CSV string or array
    const tags =
      typeof body.tags === 'string'
        ? body.tags
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : (body.tags as string[] | undefined);

    return this.service.addFileDocumentAndEmbed(agentId, {
      title: body.title!,
      fileName: file.originalname,
      mimeType: file.mimetype,
      fileBuffer: file.buffer,
      tags,
      checksum: body.checksum,
      storagePath: body.storagePath,
      vectorIdPrefix: body.vectorIdPrefix,
      embeddingModel: body.embeddingModel,
      embeddingDimensions: toNum(body.embeddingDimensions),
      chunkSize: toNum(body.chunkSize),
      chunkOverlap: toNum(body.chunkOverlap),
      metadata,
    });
  }

  /**
   * Attach extracted text for a FILE (or URL) document and immediately
   * re-chunk, embed and upsert vectors. Activates the document.
   */
  @Post('documents/:documentId/extraction')
  async upsertExtraction(
    @Param('agentId') agentId: string,
    @Param('documentId') documentId: string,
    @Body()
    body: {
      extractedText: string;
      embeddingModel?: string;
      embeddingDimensions?: number;
      chunkSize?: number;
      chunkOverlap?: number;
    }
  ): Promise<KnowledgeBaseDocument> {
    const { extractedText, ...opts } = body || ({} as any);
    if (!extractedText?.trim()) {
      throw new BadRequestException('extractedText is required');
    }
    return this.service.upsertFileExtraction(agentId, documentId, extractedText, opts);
  }

  /* ----------------------- Documents: list/get ----------------------- */

  @Get('documents')
  async listDocs(
    @Param('agentId') agentId: string,
    @Query() query: unknown
  ): Promise<Paginated<KnowledgeBaseDocument>> {
    const dto = parseListDocumentsQuery(query);
    return this.service.listDocuments(agentId, dto);
  }

  @Get('documents/:documentId')
  async getDoc(
    @Param('agentId') agentId: string,
    @Param('documentId') documentId: string
  ): Promise<KnowledgeBaseDocument> {
    return this.service.getDocument(agentId, documentId);
  }

  /* ----------------------- Documents: update/patch ----------------------- */

  /**
   * Patch title/tags/metadata/content.
   * If `reembed: true` and content present (or already stored),
   * it will re-embed and upsert vectors again.
   */
  @Patch('documents/:documentId')
  async updateDoc(
    @Param('agentId') agentId: string,
    @Param('documentId') documentId: string,
    @Body()
    body: {
      title?: string;
      tags?: string[];
      metadata?: Record<string, any>;
      content?: string | null;
      reembed?: boolean;
      chunkSize?: number;
      chunkOverlap?: number;
      embeddingModel?: string;
      embeddingDimensions?: number;
    }
  ): Promise<KnowledgeBaseDocument> {
    return this.service.updateDocument(agentId, documentId, body || {});
  }

  /* ----------------------- Documents: delete ----------------------- */

  /** Soft delete by default; pass `?hard=true` to purge Pinecone vectors and remove row */
  @Delete('documents/:documentId')
  async deleteDoc(
    @Param('agentId') agentId: string,
    @Param('documentId') documentId: string,
    @Query() query: unknown
  ): Promise<{ deleted: boolean; vectorsPurged?: number }> {
    const dto = parseDeleteDocumentQuery(query);
    return this.service.deleteDocument(agentId, documentId, dto);
  }

  /* ----------------------- Re-embed ----------------------- */

  @Post('documents/:documentId/reembed')
  async reembed(
    @Param('agentId') agentId: string,
    @Param('documentId') documentId: string,
    @Body() body: unknown
  ): Promise<{ vectorCount: number; lastUpsertedAt: Date }> {
    const dto = parseReembedDocument(body);
    return this.service.reembedDocument(agentId, documentId, dto);
  }

  /* ----------------------- Semantic search ----------------------- */

  @Post('search')
  async search(
    @Param('agentId') agentId: string,
    @Body() body: unknown
  ): Promise<KnowledgeSearchMatch[]> {
    const dto = parseKnowledgeSearch(body);
    return this.service.search(agentId, dto);
  }
}
