// src/knowledgebase/repository/knowledgebase.repository.ts
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
  Pinecone,
  type PineconeRecord,
  type RecordMetadata,
  type RecordMetadataValue,
} from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';

import type {
  IKnowledgebaseRepository,
  KnowledgeBase,
  KnowledgeBaseDocument,
  KnowledgeSearchMatch,
  KnowledgeSearchParams,
  KnowledgeChunk,
  KnowledgeItemStatus,
  KnowledgeSourceType,
} from '../interface/knowledgebase.interface';

const log = new Logger('KnowledgebaseRepository');

/* ===========================
 * ENV
 * =========================== */
const PINECONE_API_KEY = process.env.PINECONE_API_KEY!;
const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME!;
/** Data-plane host, e.g. https://myindex-xxxx.svc.us-east1-gcp.pinecone.io */
const PINECONE_HOST = process.env.PINECONE_HOST!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-large';
const EMBEDDING_DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS || 3072);

if (!PINECONE_API_KEY) throw new Error('Missing PINECONE_API_KEY');
if (!PINECONE_INDEX_NAME) throw new Error('Missing PINECONE_INDEX_NAME');
if (!PINECONE_HOST) {
  throw new Error(
    'Missing PINECONE_HOST. Set it to your index data-plane URL, e.g. https://<index>-<project>.svc.<region>.pinecone.io'
  );
}
if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');

/* ===========================
 * Clients (Pinecone v2 + OpenAI)
 * =========================== */
const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
const index = pc.index(PINECONE_INDEX_NAME);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/* ===========================
 * Helpers
 * =========================== */

function nowIso(): string {
  return new Date().toISOString();
}

/** Clamp to safe ranges */
function clampChunking(size?: number, overlap?: number) {
  const chunkSize = Math.max(200, Math.min(2000, size ?? 800));
  const maxOverlap = Math.floor(chunkSize / 2);
  const chunkOverlap = Math.max(0, Math.min(maxOverlap, overlap ?? 200));
  return { chunkSize, chunkOverlap };
}

/** Simple char-based chunking with overlap */
function chunkText(text: string, chunkSize = 800, overlap = 200): KnowledgeChunk[] {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  const out: KnowledgeChunk[] = [];
  if (!clean) return out;

  let start = 0;
  let i = 0;
  while (start < clean.length) {
    const end = Math.min(start + chunkSize, clean.length);
    const slice = clean.slice(start, end);
    out.push({
      id: '',
      documentId: '',
      chunkIndex: i,
      text: slice,
      tokenCount: slice.length,
      metadata: undefined,
    });
    i++;
    if (end === clean.length) break;
    start = Math.max(0, end - overlap);
  }
  return out;
}

async function embedBatch(
  texts: string[],
  model = EMBEDDING_MODEL,
  dims = EMBEDDING_DIMENSIONS
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await openai.embeddings.create({ model, input: texts, dimensions: dims });
  return res.data.map((d) => d.embedding as number[]);
}

/** Build SDK-shaped record with correct RecordMetadata typing */
function buildVectorPayload(
  chunk: KnowledgeChunk,
  embedding: number[],
  baseMeta: Record<string, RecordMetadataValue>
): PineconeRecord<RecordMetadata> {
  const metadata: RecordMetadata = {
    ...baseMeta,
    text: chunk.text,
    chunkIndex: chunk.chunkIndex,
  };
  if (typeof chunk.tokenCount === 'number') {
    (metadata as any).tokenCount = chunk.tokenCount;
  }

  return {
    id: chunk.id,
    values: embedding,
    metadata,
  };
}

function mergePineconeFilters(
  userFilter?: Record<string, unknown>,
  defaults: Record<string, unknown> = {}
): Record<string, unknown> | undefined {
  if (!userFilter && !defaults) return undefined;
  if (!userFilter) return defaults;
  if (!defaults) return userFilter;
  return { $and: [defaults, userFilter] };
}

/* -------- Raw HTTP helper (stable against SDK quirks) -------- */

async function pineconeHttpDeleteByIds(params: {
  namespace: string;
  ids: string[];
}): Promise<void> {
  const url = `${PINECONE_HOST.replace(/\/+$/, '')}/vectors/delete`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Api-Key': PINECONE_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      namespace: params.namespace,
      ids: params.ids,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Pinecone HTTP delete failed (${res.status} ${res.statusText}): ${text || 'no body'}`
    );
  }
}

/* ---------- Optional-deps utils (no typings required) ---------- */

function extFromName(name?: string | null): string | null {
  if (!name) return null;
  const dot = name.lastIndexOf('.');
  if (dot === -1) return null;
  return name.slice(dot + 1).toLowerCase();
}

function isTextLike(mime: string) {
  return (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/x-yaml' ||
    mime === 'application/yaml' ||
    mime === 'application/markdown' ||
    mime === 'text/markdown' ||
    mime === 'text/csv'
  );
}

/** Dynamic import with helpful error message, without requiring TS types */
async function requireOptional(name: string): Promise<any> {
  try {
    return await import(name);
  } catch {
    throw new BadRequestException(
      `Missing optional dependency "${name}". Install it to enable this file type.`
    );
  }
}

/** Extract text from buffer based on mime/ext, using dynamic imports (typed as any) */
async function extractTextFromFile(params: {
  buffer: Buffer;
  mimeType: string;
  fileName?: string | null;
}): Promise<string> {
  const { buffer, mimeType, fileName } = params;
  const ext = extFromName(fileName);

  // 1) Plain text-ish content
  if (isTextLike(mimeType) || ext === 'txt' || ext === 'md' || ext === 'csv') {
    return buffer.toString('utf8');
  }

  // 2) DOCX
  if (
    mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  ) {
    const mammoth: any = await requireOptional('mammoth');
    const res = await mammoth.extractRawText({ buffer });
    return (res?.value || '').trim();
  }

  // 3) PDF
  if (mimeType === 'application/pdf' || ext === 'pdf') {
    const pdfParse: any = await requireOptional('pdf-parse');
    const data = await pdfParse(buffer);
    return (data?.text || '').trim();
  }

  // 4) XLSX/XLS → CSV stringify
  if (
    mimeType ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel' ||
    ext === 'xlsx' ||
    ext === 'xls'
  ) {
    const XLSX: any = await requireOptional('xlsx');
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheets: string[] = wb.SheetNames || [];
    let out = '';
    for (const s of sheets) {
      const ws = wb.Sheets[s];
      if (!ws) continue;
      out += (XLSX.utils.sheet_to_csv(ws) || '') + '\n';
    }
    return out.trim();
  }

  // 5) Fallback
  throw new BadRequestException(
    `Unsupported file type for extraction. mime=${mimeType}, ext=${ext || 'n/a'}`
  );
}

/* ============================================================
 * Repository
 * ============================================================ */
@Injectable()
export class KnowledgebaseRepository implements IKnowledgebaseRepository {
  constructor(private prisma: PrismaService) {}

  /* ---------- KB ---------- */

  async ensureKnowledgeBase(agentId: string): Promise<KnowledgeBase> {
    const kb = await this.prisma.knowledgeBase.upsert({
      where: { agentId },
      update: {},
      create: {
        agentId,
        embeddingModel: EMBEDDING_MODEL,
        embeddingDimensions: EMBEDDING_DIMENSIONS,
      },
    });
    return kb as unknown as KnowledgeBase;
  }

  async getKnowledgeBaseByAgent(agentId: string): Promise<KnowledgeBase | null> {
    const kb = await this.prisma.knowledgeBase.findUnique({ where: { agentId } });
    return (kb as unknown as KnowledgeBase) ?? null;
  }

  async updateKnowledgeBase(
    agentId: string,
    patch: Partial<
      Pick<
        KnowledgeBase,
        'freeText' | 'companyName' | 'companyDescription' | 'embeddingModel' | 'embeddingDimensions'
      >
    >
  ): Promise<KnowledgeBase> {
    const kb = await this.prisma.knowledgeBase.update({
      where: { agentId },
      data: {
        freeText: patch.freeText ?? undefined,
        companyName: patch.companyName ?? undefined,
        companyDescription: patch.companyDescription ?? undefined,
        embeddingModel: patch.embeddingModel ?? undefined,
        embeddingDimensions: patch.embeddingDimensions ?? undefined,
      },
    });
    return kb as unknown as KnowledgeBase;
  }

  /* ---------- CREATE TEXT (one-shot) ---------- */

  async createTextDocument(
    agentId: string,
    input: {
      title: string;
      content: string;
      tags?: string[];
      embeddingModel?: string;
      embeddingDimensions?: number;
      chunkSize?: number;
      chunkOverlap?: number;
      vectorIdPrefix?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<KnowledgeBaseDocument> {
    const kb = await this.ensureKnowledgeBase(agentId);

    const embeddingModel = input.embeddingModel || kb.embeddingModel || EMBEDDING_MODEL;
    const embeddingDimensions =
      input.embeddingDimensions || kb.embeddingDimensions || EMBEDDING_DIMENSIONS;

    const { chunkSize, chunkOverlap } = clampChunking(input.chunkSize, input.chunkOverlap);
    const vectorIdPrefix = input.vectorIdPrefix || `doc_${uuidv4()}`;
    const vectorNamespace = agentId;

    const created = await this.prisma.knowledgeBaseDocument.create({
      data: {
        knowledgeBaseId: kb.id,
        title: input.title,
        content: input.content,
        tags: input.tags ?? [],
        sourceType: 'TEXT',
        status: 'PROCESSING',
        vectorNamespace,
        vectorIdPrefix,
        vectorCount: 0,
        embeddingModel,
        embeddingDimensions,
        chunkSize,
        chunkOverlap,
        tokenCount: input.content?.length ?? null,
        metadata: (input.metadata as Prisma.InputJsonValue) ?? undefined,
      },
    });

    try {
      const chunks = chunkText(input.content, chunkSize, chunkOverlap).map((c) => ({
        ...c,
        id: `${vectorIdPrefix}::${String(c.chunkIndex).padStart(4, '0')}`,
        documentId: created.id,
      }));

      const embeddings = await embedBatch(
        chunks.map((c) => c.text),
        embeddingModel,
        embeddingDimensions
      );

      const baseMeta: Record<string, RecordMetadataValue> = {
        agentId,
        documentId: created.id,
        vector_id_prefix: vectorIdPrefix,
        sourceType: 'TEXT',
        status: 'ACTIVE',
        title: input.title,
        createdAt: nowIso(),
      };

      const vectors: PineconeRecord<RecordMetadata>[] = embeddings.map((e, idx) =>
        buildVectorPayload(chunks[idx], e, baseMeta)
      );

      if (vectors.length > 0) {
        await index.namespace(vectorNamespace).upsert(vectors);
      }

      const updated = await this.prisma.knowledgeBaseDocument.update({
        where: { id: created.id },
        data: {
          status: 'ACTIVE',
          vectorCount: vectors.length,
          lastUpsertedAt: new Date(),
        },
      });

      return updated as unknown as KnowledgeBaseDocument;
    } catch (err: any) {
      log.error(`createTextDocument failed: ${err?.message || err}`);
      await this.prisma.knowledgeBaseDocument.update({
        where: { id: created.id },
        data: { status: 'FAILED' },
      });
      throw err;
    }
  }

  /* ---------- CREATE FILE (metadata only) ---------- */

  async createFileDocumentMeta(
    agentId: string,
    input: {
      title: string;
      tags?: string[];
      fileName: string;
      mimeType: string;
      fileSize: number;
      checksum?: string;
      storagePath?: string;
      embeddingModel?: string;
      embeddingDimensions?: number;
      chunkSize?: number;
      chunkOverlap?: number;
      vectorIdPrefix?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<KnowledgeBaseDocument> {
    const kb = await this.ensureKnowledgeBase(agentId);

    const { chunkSize, chunkOverlap } = clampChunking(input.chunkSize, input.chunkOverlap);

    const created = await this.prisma.knowledgeBaseDocument.create({
      data: {
        knowledgeBaseId: kb.id,
        title: input.title,
        tags: input.tags ?? [],
        sourceType: 'FILE',
        status: 'PROCESSING',
        fileName: input.fileName,
        fileExt: extFromName(input.fileName),
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        checksum: input.checksum ?? null,
        storagePath: input.storagePath ?? null,
        vectorNamespace: agentId,
        vectorIdPrefix: input.vectorIdPrefix || `doc_${uuidv4()}`,
        vectorCount: 0,
        embeddingModel: input.embeddingModel || kb.embeddingModel || EMBEDDING_MODEL,
        embeddingDimensions:
          input.embeddingDimensions || kb.embeddingDimensions || EMBEDDING_DIMENSIONS,
        chunkSize,
        chunkOverlap,
        tokenCount: null,
        metadata: (input.metadata as Prisma.InputJsonValue) ?? undefined,
      },
    });

    return created as unknown as KnowledgeBaseDocument;
  }

  /* ---------- CREATE FILE + EXTRACT + EMBED + UPSERT (all-in-one) ---------- */

  async createFileDocumentAndEmbed(
    agentId: string,
    input: {
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
    const kb = await this.ensureKnowledgeBase(agentId);

    const embeddingModel = input.embeddingModel || kb.embeddingModel || EMBEDDING_MODEL;
    const embeddingDimensions =
      input.embeddingDimensions || kb.embeddingDimensions || EMBEDDING_DIMENSIONS;
    const { chunkSize, chunkOverlap } = clampChunking(input.chunkSize, input.chunkOverlap);

    const vectorIdPrefix = input.vectorIdPrefix || `doc_${uuidv4()}`;
    const vectorNamespace = agentId;

    // 1) Create doc row (PROCESSING)
    const created = await this.prisma.knowledgeBaseDocument.create({
      data: {
        knowledgeBaseId: kb.id,
        title: input.title,
        tags: input.tags ?? [],
        sourceType: 'FILE',
        status: 'PROCESSING',
        fileName: input.fileName,
        fileExt: extFromName(input.fileName),
        mimeType: input.mimeType,
        fileSize: input.fileBuffer?.length ?? null,
        checksum: input.checksum ?? null,
        storagePath: input.storagePath ?? null,
        vectorNamespace,
        vectorIdPrefix,
        vectorCount: 0,
        embeddingModel,
        embeddingDimensions,
        chunkSize,
        chunkOverlap,
        tokenCount: null,
        metadata: (input.metadata as Prisma.InputJsonValue) ?? undefined,
      },
    });

    try {
      // 2) Extract text
      const extracted = await extractTextFromFile({
        buffer: input.fileBuffer,
        mimeType: input.mimeType,
        fileName: input.fileName,
      });
      const content = (extracted || '').trim();
      if (!content) {
        throw new BadRequestException(
          `No extractable text content from file "${input.fileName}" (${input.mimeType}).`
        );
      }

      // 3) Chunk → Embed → Upsert
      const chunks = chunkText(content, chunkSize, chunkOverlap).map((c) => ({
        ...c,
        id: `${vectorIdPrefix}::${String(c.chunkIndex).padStart(4, '0')}`,
        documentId: created.id,
      }));

      const embeddings = await embedBatch(
        chunks.map((c) => c.text),
        embeddingModel,
        embeddingDimensions
      );

      const baseMeta: Record<string, RecordMetadataValue> = {
        agentId,
        documentId: created.id,
        vector_id_prefix: vectorIdPrefix,
        sourceType: 'FILE',
        status: 'ACTIVE',
        title: input.title,
        createdAt: nowIso(),
        fileName: input.fileName, // always present here
      };

      const vectors: PineconeRecord<RecordMetadata>[] = embeddings.map((e, idx) =>
        buildVectorPayload(chunks[idx], e, baseMeta)
      );

      if (vectors.length > 0) {
        await index.namespace(vectorNamespace).upsert(vectors);
      }

      // 4) Persist final content + status + counts
      const updated = await this.prisma.knowledgeBaseDocument.update({
        where: { id: created.id },
        data: {
          content, // store extracted text for re-embed/debug
          tokenCount: content.length,
          status: 'ACTIVE',
          vectorCount: vectors.length,
          lastUpsertedAt: new Date(),
        },
      });

      return updated as unknown as KnowledgeBaseDocument;
    } catch (err: any) {
      log.error(`createFileDocumentAndEmbed failed: ${err?.message || err}`);
      await this.prisma.knowledgeBaseDocument.update({
        where: { id: created.id },
        data: { status: 'FAILED' },
      });
      throw err;
    }
  }

  /* ---------- CREATE URL (metadata only) ---------- */

  async createUrlDocument(
    agentId: string,
    input: {
      title: string;
      sourceUrl: string;
      tags?: string[];
      embeddingModel?: string;
      embeddingDimensions?: number;
      chunkSize?: number;
      chunkOverlap?: number;
      vectorIdPrefix?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<KnowledgeBaseDocument> {
    const kb = await this.ensureKnowledgeBase(agentId);
    const { chunkSize, chunkOverlap } = clampChunking(input.chunkSize, input.chunkOverlap);

    const created = await this.prisma.knowledgeBaseDocument.create({
      data: {
        knowledgeBaseId: kb.id,
        title: input.title,
        tags: input.tags ?? [],
        sourceType: 'URL',
        status: 'PROCESSING',
        vectorNamespace: agentId,
        vectorIdPrefix: input.vectorIdPrefix || `doc_${uuidv4()}`,
        vectorCount: 0,
        embeddingModel: input.embeddingModel || kb.embeddingModel || EMBEDDING_MODEL,
        embeddingDimensions:
          input.embeddingDimensions || kb.embeddingDimensions || EMBEDDING_DIMENSIONS,
        chunkSize,
        chunkOverlap,
        tokenCount: null,
        metadata: (input.metadata as Prisma.InputJsonValue) ?? {
          sourceUrl: input.sourceUrl,
        },
      },
    });

    return created as unknown as KnowledgeBaseDocument;
  }

  /* ---------- LIST / GET ---------- */

  async listDocuments(
    agentId: string,
    query: {
      q?: string;
      sourceType?: KnowledgeSourceType;
      status?: KnowledgeItemStatus;
      tag?: string;
      includeDeleted?: boolean;
      sort?: 'createdAt:desc' | 'createdAt:asc' | 'updatedAt:desc' | 'updatedAt:asc';
      page?: number;
      limit?: number;
    }
  ) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.KnowledgeBaseDocumentWhereInput = {
      knowledgeBase: { agentId },
      ...(query.includeDeleted ? {} : { deletedAt: null }),
      ...(query.sourceType ? { sourceType: query.sourceType as any } : {}),
      ...(query.status ? { status: query.status as any } : {}),
      ...(query.tag ? { tags: { has: query.tag } } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { content: { contains: query.q, mode: 'insensitive' } },
              { tags: { has: query.q } },
            ],
          }
        : {}),
    };

    const orderBy = (() => {
      switch (query.sort) {
        case 'createdAt:asc':
          return { createdAt: 'asc' } as const;
        case 'updatedAt:desc':
          return { updatedAt: 'desc' } as const;
        case 'updatedAt:asc':
          return { updatedAt: 'asc' } as const;
        case 'createdAt:desc':
        default:
          return { createdAt: 'desc' } as const;
      }
    })();

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.knowledgeBaseDocument.count({ where }),
      this.prisma.knowledgeBaseDocument.findMany({
        where,
        orderBy,
        skip,
        take: limit,
      }),
    ]);

    return {
      data: rows as unknown as KnowledgeBaseDocument[],
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getDocumentById(
    agentId: string,
    documentId: string
  ): Promise<KnowledgeBaseDocument | null> {
    const doc = await this.prisma.knowledgeBaseDocument.findFirst({
      where: { id: documentId, knowledgeBase: { agentId } },
    });
    return (doc as unknown as KnowledgeBaseDocument) ?? null;
  }

  /* ---------- UPDATE (PATCH) ---------- */

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
    const existing = await this.prisma.knowledgeBaseDocument.findFirst({
      where: { id: documentId, knowledgeBase: { agentId } },
    });
    if (!existing) throw new NotFoundException('Document not found');

    const { chunkSize, chunkOverlap } = clampChunking(
      patch.chunkSize ?? existing.chunkSize,
      patch.chunkOverlap ?? existing.chunkOverlap
    );

    const updated = await this.prisma.knowledgeBaseDocument.update({
      where: { id: documentId },
      data: {
        title: patch.title ?? undefined,
        tags: patch.tags ?? undefined,
        metadata: (patch.metadata as Prisma.InputJsonValue) ?? undefined,
        content: patch.content === undefined ? undefined : patch.content,
        chunkSize,
        chunkOverlap,
        embeddingModel: patch.embeddingModel ?? undefined,
        embeddingDimensions: patch.embeddingDimensions ?? undefined,
        status: patch.content !== undefined && patch.reembed ? 'PROCESSING' : undefined,
        deletedAt: null,
      },
    });

    if (patch.reembed && (patch.content ?? updated.content)) {
      await this.reembedDocument(agentId, documentId, {
        embeddingModel: patch.embeddingModel ?? updated.embeddingModel ?? undefined,
        embeddingDimensions: patch.embeddingDimensions ?? updated.embeddingDimensions ?? undefined,
        chunkSize,
        chunkOverlap,
        force: true,
      });
      const fresh = await this.getDocumentById(agentId, documentId);
      if (!fresh) throw new NotFoundException('Document not found after re-embed');
      return fresh;
    }

    return updated as unknown as KnowledgeBaseDocument;
  }

  async updateDocumentPatch(
    agentId: string,
    documentId: string,
    patch: {
      title?: string;
      content?: string;
      tags?: string[];
      metadata?: Record<string, unknown>;
    }
  ): Promise<KnowledgeBaseDocument> {
    return this.updateDocument(agentId, documentId, { ...patch, reembed: false });
  }

  /** Convenience for file pipeline: set extracted text, then embed + upsert */
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
    const { chunkSize, chunkOverlap } = clampChunking(opts?.chunkSize, opts?.chunkOverlap);
    const content = (extractedText || '').trim();
    if (!content) throw new BadRequestException('Empty extracted text.');

    await this.prisma.knowledgeBaseDocument.update({
      where: { id: documentId },
      data: {
        content,
        tokenCount: content.length,
        status: 'PROCESSING',
        deletedAt: null,
        embeddingModel: opts?.embeddingModel ?? undefined,
        embeddingDimensions: opts?.embeddingDimensions ?? undefined,
        chunkSize,
        chunkOverlap,
      },
    });

    await this.reembedDocument(agentId, documentId, {
      embeddingModel: opts?.embeddingModel,
      embeddingDimensions: opts?.embeddingDimensions,
      chunkSize,
      chunkOverlap,
      force: true,
    });

    const fresh = await this.getDocumentById(agentId, documentId);
    if (!fresh) throw new NotFoundException('Document not found after upsert');
    return fresh;
  }

  /* ---------- DELETE ---------- */

  async deleteDocument(
    agentId: string,
    documentId: string,
    hard = false
  ): Promise<{ deleted: boolean; vectorsPurged?: number }> {
    const doc = await this.prisma.knowledgeBaseDocument.findFirst({
      where: { id: documentId, knowledgeBase: { agentId } },
    });
    if (!doc) throw new NotFoundException('Document not found');

    if (hard) {
      const purged = await this.purgeVectorsForDocument(agentId, doc.vectorIdPrefix, doc.vectorCount);
      await this.prisma.knowledgeBaseDocument.delete({ where: { id: documentId } });
      return { deleted: true, vectorsPurged: purged };
    }

    await this.prisma.knowledgeBaseDocument.update({
      where: { id: documentId },
      data: { status: 'DELETED', deletedAt: new Date() },
    });
    return { deleted: true };
  }

  /* ---------- RE-EMBED ---------- */

  async reembedDocument(
    agentId: string,
    documentId: string,
    options?: {
      embeddingModel?: string;
      embeddingDimensions?: number;
      chunkSize?: number;
      chunkOverlap?: number;
      force?: boolean;
    }
  ): Promise<{ vectorCount: number; lastUpsertedAt: Date }> {
    const doc = await this.prisma.knowledgeBaseDocument.findFirst({
      where: { id: documentId, knowledgeBase: { agentId } },
    });
    if (!doc) throw new NotFoundException('Document not found');

    if (doc.sourceType === 'FILE' && !doc.content) {
      throw new BadRequestException('File document has no extracted content yet.');
    }
    const text = (doc.content || '').trim();
    if (!text) throw new BadRequestException('Document has no content to embed.');

    const { chunkSize, chunkOverlap } = clampChunking(
      options?.chunkSize ?? doc.chunkSize ?? 800,
      options?.chunkOverlap ?? doc.chunkOverlap ?? 200
    );
    const embeddingModel = options?.embeddingModel ?? doc.embeddingModel ?? EMBEDDING_MODEL;
    const embeddingDimensions =
      options?.embeddingDimensions ?? doc.embeddingDimensions ?? EMBEDDING_DIMENSIONS;

    // Clear old vectors (if we believe there were any)
    if ((doc.vectorCount ?? 0) > 0) {
      await this.purgeVectorsForDocument(agentId, doc.vectorIdPrefix, doc.vectorCount);
    }

    const chunks = chunkText(text, chunkSize, chunkOverlap).map((c) => ({
      ...c,
      id: `${doc.vectorIdPrefix}::${String(c.chunkIndex).padStart(4, '0')}`,
      documentId: doc.id,
    }));
    const embeddings = await embedBatch(
      chunks.map((c) => c.text),
      embeddingModel,
      embeddingDimensions
    );

    // Build metadata, conditionally include fileName only if defined (to avoid TS2322)
    const baseMeta: Record<string, RecordMetadataValue> = {
      agentId,
      documentId: doc.id,
      vector_id_prefix: doc.vectorIdPrefix,
      sourceType: doc.sourceType,
      status: 'ACTIVE',
      title: doc.title,
      reembeddedAt: nowIso(),
    };
    if (doc.fileName) {
      (baseMeta as any).fileName = doc.fileName; // add only when present
    }

    const vectors: PineconeRecord<RecordMetadata>[] = embeddings.map((e, idx) =>
      buildVectorPayload(chunks[idx], e, baseMeta)
    );

    if (vectors.length > 0) {
      await index.namespace(agentId).upsert(vectors);
    }

    const updated = await this.prisma.knowledgeBaseDocument.update({
      where: { id: doc.id },
      data: {
        status: 'ACTIVE',
        vectorCount: vectors.length,
        lastUpsertedAt: new Date(),
        chunkSize,
        chunkOverlap,
        embeddingModel,
        embeddingDimensions,
      },
    });

    return { vectorCount: updated.vectorCount, lastUpsertedAt: updated.lastUpsertedAt! };
  }

  /* ---------- SEARCH ---------- */

  async search(params: KnowledgeSearchParams): Promise<KnowledgeSearchMatch[]> {
    const { namespace, query, topK = 8, includeMetadata = true, filter } = params;
    if (!query || !query.trim()) return [];

    const [vector] = await embedBatch([query]);
    const defaultFilter = { status: { $eq: 'ACTIVE' } };
    const mergedFilter = mergePineconeFilters(filter, defaultFilter);

    const results = await index.namespace(namespace).query({
      vector,
      topK,
      includeValues: false,
      includeMetadata,
      filter: mergedFilter,
    });

    return (results.matches || []).map((m) => ({
      id: m.id,
      score: m.score ?? undefined,
      metadata: (m.metadata as Record<string, unknown>) || undefined,
      documentId: (m.metadata as any)?.documentId,
      chunkIndex: (m.metadata as any)?.chunkIndex,
      text: (m.metadata as any)?.text,
    }));
  }

  /* ---------- Vector maintenance ---------- */

  /**
   * Purge document vectors via raw HTTP delete with top-level { ids }.
   * This avoids the SDK bug that sometimes nests "ids" under "filter".
   */
  async purgeVectorsForDocument(
    namespace: string,
    vectorIdPrefix: string,
    vectorCount?: number | null
  ): Promise<number> {
    const count = Math.max(0, Number(vectorCount ?? 0));
    if (count === 0) return 0;

    const ids: string[] = Array.from({ length: count }, (_, i) =>
      `${vectorIdPrefix}::${String(i).padStart(4, '0')}`
    );

    const BATCH = 1000;
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      await pineconeHttpDeleteByIds({ namespace, ids: chunk });
    }
    return ids.length;
  }
}
