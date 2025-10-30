// src/knowledgebase/schema/knowledgebase.schema.ts
import { z } from 'zod';

/* ================================
 * Defaults (from .env when present)
 * ================================ */
const DEFAULT_EMBEDDING_MODEL =
  (process.env.EMBEDDING_MODEL ?? 'text-embedding-3-large').trim();

const DEFAULT_EMBEDDING_DIMENSIONS = (() => {
  const n = Number(process.env.EMBEDDING_DIMENSIONS);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 3072;
})();

/* ================================
 * Enums (mirror Prisma)
 * ================================ */
export const KnowledgeSourceTypeEnum = z.enum(['TEXT', 'FILE', 'URL']);
export const KnowledgeItemStatusEnum = z.enum([
  'PROCESSING',
  'ACTIVE',
  'FAILED',
  'DELETED',
]);

/* ================================
 * Shared constraints
 * ================================ */
const TagSchema = z
  .string()
  .trim()
  .min(1)
  .max(64); // compact tags help filtering/indexing

export const ChunkingConstraints = {
  chunkSize: z.coerce.number().int().min(200).max(4000).default(800),
  chunkOverlap: z.coerce.number().int().min(0).max(1000).default(200),
};

export const PaginationSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

/* ================================
 * Route param schemas
 * ================================ */
export const AgentIdParamSchema = z
  .object({
    agentId: z.string().uuid(),
  })
  .strict();

export const KnowledgeBaseIdParamSchema = z
  .object({
    knowledgeBaseId: z.string().uuid(),
  })
  .strict();

export const DocumentIdParamSchema = z
  .object({
    documentId: z.string().uuid(),
  })
  .strict();

/* ================================
 * Helpers
 * ================================ */
const PineconeSafeId = z
  .string()
  .regex(/^[A-Za-z0-9_\-:.]+$/, 'Only letters, numbers, _ - : . are allowed')
  .min(1)
  .max(120);

const EmbeddingModelSchema = z.string().min(1).max(200);

const EmbeddingDimsSchema = z.coerce.number().int().min(128).max(8192);

/**
 * Optional refinement: when model is text-embedding-3-large,
 * enforce dimensions = 3072 to avoid Pinecone/OpenAI mismatch.
 */
function withModelDimGuard<T extends z.ZodTypeAny>(schema: T) {
  const getProp = <V>(
    obj: unknown,
    key: string
  ): V | undefined => (obj && typeof obj === 'object' ? (obj as any)[key] : undefined);

  return schema.superRefine((val, ctx) => {
    const model = getProp<string>(val, 'embeddingModel');
    const dims = getProp<number>(val, 'embeddingDimensions');

    if (
      model &&
      /text-embedding-3-large/i.test(model) &&
      typeof dims === 'number' &&
      dims !== 3072
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'embeddingDimensions must be 3072 when embeddingModel is text-embedding-3-large',
        path: ['embeddingDimensions'],
      });
    }
  });
}

/* ================================
 * KnowledgeBase create/update
 * ================================ */
export const CreateKnowledgeBaseSchema = withModelDimGuard(
  z
    .object({
      freeText: z.string().max(50_000).optional(),
      companyName: z.string().trim().max(300).optional(),
      companyDescription: z.string().trim().max(10_000).optional(),
      embeddingModel: EmbeddingModelSchema.default(DEFAULT_EMBEDDING_MODEL),
      embeddingDimensions: EmbeddingDimsSchema.default(
        DEFAULT_EMBEDDING_DIMENSIONS
      ),
    })
    .strict()
);

export const UpdateKnowledgeBaseSchema = withModelDimGuard(
  z
    .object({
      freeText: z.string().max(50_000).optional(),
      companyName: z.string().trim().max(300).optional(),
      companyDescription: z.string().trim().max(10_000).optional(),
      embeddingModel: EmbeddingModelSchema.optional(),
      embeddingDimensions: EmbeddingDimsSchema.optional(),
    })
    .strict()
);

/* ================================
 * Document: create (TEXT)
 * ================================ */
export const CreateTextDocumentSchema = withModelDimGuard(
  z
    .object({
      title: z.string().trim().min(1).max(200).default('Untitled'),
      content: z.string().min(1, 'content is required'),
      tags: z.array(TagSchema).max(20).default([]),

      // Optional overrides (fall back to KB defaults)
      embeddingModel: EmbeddingModelSchema.optional(),
      embeddingDimensions: EmbeddingDimsSchema.optional(),

      // Chunking controls
      ...ChunkingConstraints,

      // Optional client-provided prefix to build stable vector IDs
      vectorIdPrefix: PineconeSafeId.optional(),

      // Free-form metadata to persist alongside the vectors
      metadata: z.record(z.any()).optional(),
    })
    .strict()
);

/* ================================
 * Document: create (FILE metadata)
 * NOTE: binary file is handled via multipart; this schema validates its metadata/body.
 * ================================ */
export const CreateFileDocumentMetaSchema = withModelDimGuard(
  z
    .object({
      title: z.string().trim().min(1).max(200),
      tags: z.array(TagSchema).max(20).default([]),

      fileName: z.string().trim().min(1),
      mimeType: z.string().trim().min(1),
      fileSize: z.coerce.number().int().min(1),
      checksum: z.string().trim().max(128).optional(), // e.g., sha256

      // Optional overrides (fall back to KB defaults)
      embeddingModel: EmbeddingModelSchema.optional(),
      embeddingDimensions: EmbeddingDimsSchema.optional(),

      // Chunking controls for extracted text
      ...ChunkingConstraints,

      vectorIdPrefix: PineconeSafeId.optional(),

      metadata: z.record(z.any()).optional(),
    })
    .strict()
);

/* ================================
 * Document: create (URL source)
 * ================================ */
export const CreateUrlDocumentSchema = withModelDimGuard(
  z
    .object({
      title: z.string().trim().min(1).max(200).default('Untitled'),
      sourceUrl: z.string().url(),
      tags: z.array(TagSchema).max(20).default([]),

      // Optional overrides
      embeddingModel: EmbeddingModelSchema.optional(),
      embeddingDimensions: EmbeddingDimsSchema.optional(),

      // Chunking controls for fetched page text
      ...ChunkingConstraints,

      vectorIdPrefix: PineconeSafeId.optional(),
      metadata: z.record(z.any()).optional(),
    })
    .strict()
);

/* ================================
 * Document: patch (title/tags/content)
 * ================================ */
export const UpdateDocumentPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    content: z.string().min(1).optional(), // for TEXT docs
    tags: z.array(TagSchema).max(20).optional(),
    metadata: z.record(z.any()).optional(),
  })
  .strict();

/* ================================
 * Document: list/query
 * ================================ */
export const ListDocumentsQuerySchema = PaginationSchema.extend({
  q: z.string().max(500).optional(), // fuzzy over title/content/tags
  sourceType: KnowledgeSourceTypeEnum.optional(),
  status: KnowledgeItemStatusEnum.optional(),
  tag: z.string().optional(),
  includeDeleted: z.coerce.boolean().default(false),
  sort: z
    .enum(['createdAt:desc', 'createdAt:asc', 'updatedAt:desc', 'updatedAt:asc'])
    .default('createdAt:desc'),
}).strict();

/* ================================
 * Vector search (retrieve)
 * ================================ */
export const KnowledgeSearchSchema = z
  .object({
    query: z.string().min(1),
    topK: z.coerce.number().int().min(1).max(50).default(8),
    includeMetadata: z.coerce.boolean().default(true),
    // Pinecone metadata filter (JSON)
    filter: z.record(z.any()).optional(),
    // Optional rerank/hybrid params (handled by service if supported)
    hybridAlpha: z.coerce.number().min(0).max(1).optional(),
  })
  .strict();

/* ================================
 * Document: delete
 * - soft delete by default (status=DELETED + deletedAt)
 * - when hard=true, also purge vectors in Pinecone
 * ================================ */
export const DeleteDocumentQuerySchema = z
  .object({
    hard: z.coerce.boolean().default(false),
  })
  .strict();

/* ================================
 * Re-embed / Reprocess a document
 * ================================ */
export const ReembedDocumentSchema = withModelDimGuard(
  z
    .object({
      embeddingModel: EmbeddingModelSchema.optional(),
      embeddingDimensions: EmbeddingDimsSchema.optional(),
      // Optionally adjust chunking and re-run extraction
      ...ChunkingConstraints,
      force: z.coerce.boolean().default(false),
    })
    .strict()
);

/* ================================
 * Inferred Types
 * ================================ */
export type CreateKnowledgeBaseDto = z.infer<typeof CreateKnowledgeBaseSchema>;
export type UpdateKnowledgeBaseDto = z.infer<typeof UpdateKnowledgeBaseSchema>;
export type CreateTextDocumentDto = z.infer<typeof CreateTextDocumentSchema>;
export type CreateFileDocumentMetaDto = z.infer<
  typeof CreateFileDocumentMetaSchema
>;
export type CreateUrlDocumentDto = z.infer<typeof CreateUrlDocumentSchema>;
export type UpdateDocumentPatchDto = z.infer<typeof UpdateDocumentPatchSchema>;
export type ListDocumentsQuery = z.infer<typeof ListDocumentsQuerySchema>;
export type KnowledgeSearchDto = z.infer<typeof KnowledgeSearchSchema>;
export type DeleteDocumentQuery = z.infer<typeof DeleteDocumentQuerySchema>;
export type ReembedDocumentDto = z.infer<typeof ReembedDocumentSchema>;
