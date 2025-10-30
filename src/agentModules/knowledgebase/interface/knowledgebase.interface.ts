// src/knowledgebase/interface/knowledgebase.interface.ts

/* ============================================
 * Enums (mirror Prisma + schema)
 * ============================================ */
export type KnowledgeSourceType = 'TEXT' | 'FILE' | 'URL';
export type KnowledgeItemStatus = 'PROCESSING' | 'ACTIVE' | 'FAILED' | 'DELETED';

/* ============================================
 * Core models (domain-level, not Prisma types)
 * ============================================ */
export interface KnowledgeBase {
  id: string;
  agentId: string; // Pinecone namespace MUST equal this in services
  freeText?: string | null;
  companyName?: string | null;
  companyDescription?: string | null;

  // Default embedding settings (can be overridden per-document)
  embeddingModel: string;     // e.g., "text-embedding-3-large"
  embeddingDimensions: number; // e.g., 3072

  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeBaseDocument {
  id: string;
  knowledgeBaseId: string;

  title: string;
  content?: string | null; // extracted or raw text (TEXT docs; optional preview for FILE/URL)
  tags: string[];

  sourceType: KnowledgeSourceType;
  status: KnowledgeItemStatus;
  deletedAt?: Date | null;

  // File metadata (when sourceType === 'FILE')
  fileName?: string | null;
  fileExt?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  checksum?: string | null;
  storagePath?: string | null; // e.g., S3/local path

  // Pinecone vector mapping
  vectorNamespace: string; // MUST equal Agent.id
  vectorIdPrefix: string;  // used to build chunk IDs; unique per document
  vectorCount: number;
  lastUpsertedAt?: Date | null;

  // Persisted embedding/chunking settings
  embeddingModel: string;
  embeddingDimensions: number;
  chunkSize: number;
  chunkOverlap: number;
  tokenCount?: number | null;

  // Extra metadata (arbitrary)
  metadata?: Record<string, unknown> | null;

  createdAt: Date;
  updatedAt: Date;
}

/* ============================================
 * Operational shapes (service/repository layer)
 * ============================================ */

// A single logical chunk produced from a document
export interface KnowledgeChunk {
  id: string; // `${vectorIdPrefix}::${chunkIndex.toString().padStart(4,'0')}`
  documentId: string;
  chunkIndex: number;
  text: string;
  tokenCount?: number;
  metadata?: Record<string, unknown>;
}

// Upsert payload for Pinecone (decoupled from SDK types)
export interface PineconeVector {
  id: string;
  values: number[]; // dense embedding vector
  // Optional sparse component for hybrid search (if you use it)
  sparseValues?: {
    indices: number[];
    values: number[];
  };
  metadata?: Record<string, unknown>;
  // namespace is passed separately on the SDK call (must be agentId)
}

export interface KnowledgeSearchParams {
  namespace: string; // agentId
  query: string;
  topK?: number; // default 8
  includeMetadata?: boolean; // default true
  filter?: Record<string, unknown>;
  hybridAlpha?: number; // optional for hybrid search
}

export interface KnowledgeSearchMatch {
  id: string;
  score?: number;
  metadata?: Record<string, unknown>;
  // Convenience fields (typically mirrored in metadata)
  documentId?: string;
  chunkIndex?: number;
  text?: string;
}

export interface Paginated<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/* ============================================
 * Repository contract (ports)
 * Implement with Prisma + Pinecone in /repository
 * ============================================ */
export interface IKnowledgebaseRepository {
  /* -------- KB lifecycle -------- */
  ensureKnowledgeBase(agentId: string): Promise<KnowledgeBase>;
  getKnowledgeBaseByAgent(agentId: string): Promise<KnowledgeBase | null>;
  updateKnowledgeBase(
    agentId: string,
    patch: Partial<
      Pick<
        KnowledgeBase,
        'freeText' | 'companyName' | 'companyDescription' | 'embeddingModel' | 'embeddingDimensions'
      >
    >
  ): Promise<KnowledgeBase>;

  /* -------- Document create -------- */
  createTextDocument(
    agentId: string,
    input: {
      title: string;
      content: string;
      tags?: string[];
      embeddingModel?: string;
      embeddingDimensions?: number;
      chunkSize?: number;
      chunkOverlap?: number;
      vectorIdPrefix?: string; // Pinecone-safe id seed
      metadata?: Record<string, unknown>;
    }
  ): Promise<KnowledgeBaseDocument>;

  createFileDocumentMeta(
    agentId: string,
    input: {
      title: string;
      tags?: string[];
      fileName: string;
      mimeType: string;
      fileSize: number;
      checksum?: string;
      storagePath?: string; // set by uploader
      embeddingModel?: string;
      embeddingDimensions?: number;
      chunkSize?: number;
      chunkOverlap?: number;
      vectorIdPrefix?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<KnowledgeBaseDocument>;

  createUrlDocument(
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
  ): Promise<KnowledgeBaseDocument>;

  /* -------- Document update/patch -------- */
  updateDocumentPatch(
    agentId: string,
    documentId: string,
    patch: {
      title?: string;
      content?: string; // TEXT docs
      tags?: string[];
      metadata?: Record<string, unknown>;
    }
  ): Promise<KnowledgeBaseDocument>;

  /* -------- Document listing / fetching -------- */
  listDocuments(
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
  ): Promise<Paginated<KnowledgeBaseDocument>>;

  getDocumentById(
    agentId: string,
    documentId: string
  ): Promise<KnowledgeBaseDocument | null>;

  /* -------- Delete (soft by default) + optional hard purge -------- */
  deleteDocument(
    agentId: string,
    documentId: string,
    hard?: boolean
  ): Promise<{ deleted: boolean; vectorsPurged?: number }>;

  /* -------- Re-embedding / reprocessing -------- */
  reembedDocument(
    agentId: string,
    documentId: string,
    options?: {
      embeddingModel?: string;
      embeddingDimensions?: number;
      chunkSize?: number;
      chunkOverlap?: number;
      force?: boolean; // re-run even if settings are unchanged
    }
  ): Promise<{ vectorCount: number; lastUpsertedAt: Date }>;

  /* -------- Vector search -------- */
  search(params: KnowledgeSearchParams): Promise<KnowledgeSearchMatch[]>;

  /* -------- Vector maintenance helpers -------- */
  purgeVectorsForDocument(namespace: string, vectorIdPrefix: string): Promise<number>;
}
