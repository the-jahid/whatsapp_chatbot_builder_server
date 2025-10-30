// src/knowledgebase/knowledgebase.service.ts
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { KnowledgebaseRepository } from './repository/knowledgebase.repository';

import type {
  KnowledgeBase,
  KnowledgeBaseDocument,
  KnowledgeSearchMatch,
  Paginated,
} from './interface/knowledgebase.interface';

import type {
  UpdateKnowledgeBaseDto,
  CreateTextDocumentDto,
  CreateFileDocumentMetaDto,
  ListDocumentsQueryDto,
  KnowledgeSearchDto,
  DeleteDocumentQueryDto,
  ReembedDocumentDto,
} from './dto/knowledgebase.dto';

const log = new Logger('KnowledgebaseService');

@Injectable()
export class KnowledgebaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: KnowledgebaseRepository
  ) {}

  /* -----------------------------------------------------------
   * Guards / helpers
   * ----------------------------------------------------------- */
  private async assertAgentExists(agentId: string): Promise<void> {
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) {
      throw new NotFoundException('Agent not found');
    }
  }

  /* -----------------------------------------------------------
   * KnowledgeBase
   * ----------------------------------------------------------- */

  /** Ensure a KB exists for an agent (creates if missing). */
  async ensureKnowledgeBase(agentId: string): Promise<KnowledgeBase> {
    await this.assertAgentExists(agentId);
    return this.repo.ensureKnowledgeBase(agentId);
  }

  /** Get KB; if missing, auto-create (simpler UX). */
  async getKnowledgeBase(agentId: string): Promise<KnowledgeBase> {
    await this.assertAgentExists(agentId);
    const kb = await this.repo.getKnowledgeBaseByAgent(agentId);
    return kb ?? this.repo.ensureKnowledgeBase(agentId);
  }

  /** Update KB settings/metadata (defaults stored on KB). */
  async updateKnowledgeBase(
    agentId: string,
    dto: UpdateKnowledgeBaseDto
  ): Promise<KnowledgeBase> {
    await this.assertAgentExists(agentId);
    // ensure row exists so update won't throw
    await this.repo.ensureKnowledgeBase(agentId);
    return this.repo.updateKnowledgeBase(agentId, dto);
  }

  /* -----------------------------------------------------------
   * Documents: create/upsert
   * ----------------------------------------------------------- */

  /** Create + chunk + embed + upsert TEXT document to Pinecone (namespace = agentId). */
  async addTextDocument(
    agentId: string,
    dto: CreateTextDocumentDto
  ): Promise<KnowledgeBaseDocument> {
    await this.assertAgentExists(agentId);
    if (!dto.content?.trim()) {
      throw new BadRequestException('content is required');
    }
    return this.repo.createTextDocument(agentId, dto);
  }

  /**
   * Create FILE document metadata row. Actual file upload and text extraction
   * happen outside; call `upsertFileExtraction` (or `reembedDocument`) later.
   */
  async addFileDocumentMeta(
    agentId: string,
    dto: CreateFileDocumentMetaDto
  ): Promise<KnowledgeBaseDocument> {
    await this.assertAgentExists(agentId);
    return this.repo.createFileDocumentMeta(agentId, dto);
  }

  /**
   * NEW: One-shot file ingestion.
   * Creates the FILE document, extracts text from the provided buffer,
   * chunks → embeds → upserts vectors, and activates the document.
   *
   * Use this when you already have the file bytes in memory.
   */
  async addFileDocumentAndEmbed(
    agentId: string,
    params: {
      title: string;
      fileName: string;
      mimeType: string;
      fileBuffer: Buffer;
      tags?: string[];
      checksum?: string;
      storagePath?: string;
      vectorIdPrefix?: string;
      embeddingModel?: string;
      embeddingDimensions?: number;
      chunkSize?: number;
      chunkOverlap?: number;
      metadata?: Record<string, unknown>;
    }
  ): Promise<KnowledgeBaseDocument> {
    await this.assertAgentExists(agentId);

    if (!params?.fileBuffer || !(params.fileBuffer instanceof Buffer)) {
      throw new BadRequestException('fileBuffer (Buffer) is required');
    }
    if (!params.title?.trim()) throw new BadRequestException('title is required');
    if (!params.fileName?.trim()) throw new BadRequestException('fileName is required');
    if (!params.mimeType?.trim()) throw new BadRequestException('mimeType is required');

    return this.repo.createFileDocumentAndEmbed(agentId, params);
  }

  /**
   * Convenience for file pipeline:
   * - store extracted text on the file document
   * - chunk + embed + upsert vectors
   * - activate the document
   */
  async upsertFileExtraction(
    agentId: string,
    documentId: string,
    extractedText: string,
    opts?: {
      embeddingModel?: string;
      embeddingDimensions?: number;
      chunkSize?: number;
      chunkOverlap?: number;
    }
  ): Promise<KnowledgeBaseDocument> {
    await this.assertAgentExists(agentId);
    if (!extractedText?.trim()) {
      throw new BadRequestException('extractedText is empty');
    }
    return this.repo.upsertFileExtraction(agentId, documentId, extractedText, opts);
  }

  /* -----------------------------------------------------------
   * Documents: read/list
   * ----------------------------------------------------------- */

  async listDocuments(
    agentId: string,
    query: ListDocumentsQueryDto
  ): Promise<Paginated<KnowledgeBaseDocument>> {
    await this.assertAgentExists(agentId);
    return this.repo.listDocuments(agentId, query);
  }

  async getDocument(
    agentId: string,
    documentId: string
  ): Promise<KnowledgeBaseDocument> {
    await this.assertAgentExists(agentId);
    const doc = await this.repo.getDocumentById(agentId, documentId);
    if (!doc) {
      throw new NotFoundException('Document not found');
    }
    return doc;
  }

  /* -----------------------------------------------------------
   * Documents: update/patch
   * ----------------------------------------------------------- */

  /**
   * Update document fields (title/tags/metadata/content).
   * If `reembed` is true and `content` is provided (or already exists),
   * this will re-chunk, re-embed and re-upsert vectors.
   */
  async updateDocument(
    agentId: string,
    documentId: string,
    patch: {
      title?: string;
      tags?: string[];
      metadata?: Record<string, unknown>;
      content?: string | null;
      reembed?: boolean;
      chunkSize?: number;
      chunkOverlap?: number;
      embeddingModel?: string;
      embeddingDimensions?: number;
    }
  ): Promise<KnowledgeBaseDocument> {
    await this.assertAgentExists(agentId);
    return this.repo.updateDocument(agentId, documentId, patch);
  }

  /* -----------------------------------------------------------
   * Delete (soft / hard purge vectors)
   * ----------------------------------------------------------- */

  async deleteDocument(
    agentId: string,
    documentId: string,
    query?: DeleteDocumentQueryDto
  ): Promise<{ deleted: boolean; vectorsPurged?: number }> {
    await this.assertAgentExists(agentId);
    return this.repo.deleteDocument(agentId, documentId, query?.hard ?? false);
  }

  /* -----------------------------------------------------------
   * Re-embed existing document (text or extracted file)
   * ----------------------------------------------------------- */

  async reembedDocument(
    agentId: string,
    documentId: string,
    dto?: ReembedDocumentDto
  ): Promise<{ vectorCount: number; lastUpsertedAt: Date }> {
    await this.assertAgentExists(agentId);
    return this.repo.reembedDocument(agentId, documentId, dto);
  }

  /* -----------------------------------------------------------
   * Semantic search (retrieve) in namespace = agentId
   * ----------------------------------------------------------- */

  async search(
    agentId: string,
    dto: KnowledgeSearchDto
  ): Promise<KnowledgeSearchMatch[]> {
    await this.assertAgentExists(agentId);
    return this.repo.search({
      namespace: agentId,
      query: dto.query,
      topK: dto.topK,
      includeMetadata: dto.includeMetadata,
      filter: dto.filter,
      hybridAlpha: dto.hybridAlpha,
    });
  }
}
