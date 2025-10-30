// src/knowledgebase/dto/knowledgebase.dto.ts
import { z } from 'zod';
import {
  AgentIdParamSchema,
  KnowledgeBaseIdParamSchema,
  DocumentIdParamSchema,
  CreateKnowledgeBaseSchema,
  UpdateKnowledgeBaseSchema,
  CreateTextDocumentSchema,
  CreateFileDocumentMetaSchema,
  CreateUrlDocumentSchema,
  UpdateDocumentPatchSchema,
  ListDocumentsQuerySchema,
  KnowledgeSearchSchema,
  DeleteDocumentQuerySchema,
  ReembedDocumentSchema,
} from '../schema/knowledgebase.schema';

/* ================================
 * Type aliases (DTOs)
 * ================================ */
export type AgentIdParamDto = z.infer<typeof AgentIdParamSchema>;
export type KnowledgeBaseIdParamDto = z.infer<typeof KnowledgeBaseIdParamSchema>;
export type DocumentIdParamDto = z.infer<typeof DocumentIdParamSchema>;

export type CreateKnowledgeBaseDto = z.infer<typeof CreateKnowledgeBaseSchema>;
export type UpdateKnowledgeBaseDto = z.infer<typeof UpdateKnowledgeBaseSchema>;

export type CreateTextDocumentDto = z.infer<typeof CreateTextDocumentSchema>;
export type CreateFileDocumentMetaDto = z.infer<
  typeof CreateFileDocumentMetaSchema
>;
export type CreateUrlDocumentDto = z.infer<typeof CreateUrlDocumentSchema>;
export type UpdateDocumentPatchDto = z.infer<typeof UpdateDocumentPatchSchema>;

export type ListDocumentsQueryDto = z.infer<typeof ListDocumentsQuerySchema>;
export type KnowledgeSearchDto = z.infer<typeof KnowledgeSearchSchema>;
export type DeleteDocumentQueryDto = z.infer<typeof DeleteDocumentQuerySchema>;
export type ReembedDocumentDto = z.infer<typeof ReembedDocumentSchema>;

/* ================================
 * Parsers (for Controllers/Services)
 * ================================ */
export const parseAgentIdParam = (data: unknown): AgentIdParamDto =>
  AgentIdParamSchema.parse(data);

export const parseKnowledgeBaseIdParam = (
  data: unknown
): KnowledgeBaseIdParamDto => KnowledgeBaseIdParamSchema.parse(data);

export const parseDocumentIdParam = (data: unknown): DocumentIdParamDto =>
  DocumentIdParamSchema.parse(data);

export const parseCreateKnowledgeBase = (
  data: unknown
): CreateKnowledgeBaseDto => CreateKnowledgeBaseSchema.parse(data);

export const parseUpdateKnowledgeBase = (
  data: unknown
): UpdateKnowledgeBaseDto => UpdateKnowledgeBaseSchema.parse(data);

export const parseCreateTextDocument = (
  data: unknown
): CreateTextDocumentDto => CreateTextDocumentSchema.parse(data);

export const parseCreateFileDocumentMeta = (
  data: unknown
): CreateFileDocumentMetaDto => CreateFileDocumentMetaSchema.parse(data);

export const parseCreateUrlDocument = (
  data: unknown
): CreateUrlDocumentDto => CreateUrlDocumentSchema.parse(data);

export const parseUpdateDocumentPatch = (
  data: unknown
): UpdateDocumentPatchDto => UpdateDocumentPatchSchema.parse(data);

export const parseListDocumentsQuery = (
  data: unknown
): ListDocumentsQueryDto => ListDocumentsQuerySchema.parse(data);

export const parseKnowledgeSearch = (data: unknown): KnowledgeSearchDto =>
  KnowledgeSearchSchema.parse(data);

export const parseDeleteDocumentQuery = (
  data: unknown
): DeleteDocumentQueryDto => DeleteDocumentQuerySchema.parse(data);

export const parseReembedDocument = (
  data: unknown
): ReembedDocumentDto => ReembedDocumentSchema.parse(data);

/* ================================
 * Re-exports of Zod Schemas (optional convenience)
 * ================================ */
export {
  AgentIdParamSchema as ZAgentIdParam,
  KnowledgeBaseIdParamSchema as ZKnowledgeBaseIdParam,
  DocumentIdParamSchema as ZDocumentIdParam,
  CreateKnowledgeBaseSchema as ZCreateKnowledgeBase,
  UpdateKnowledgeBaseSchema as ZUpdateKnowledgeBase,
  CreateTextDocumentSchema as ZCreateTextDocument,
  CreateFileDocumentMetaSchema as ZCreateFileDocumentMeta,
  CreateUrlDocumentSchema as ZCreateUrlDocument,
  UpdateDocumentPatchSchema as ZUpdateDocumentPatch,
  ListDocumentsQuerySchema as ZListDocumentsQuery,
  KnowledgeSearchSchema as ZKnowledgeSearch,
  DeleteDocumentQuerySchema as ZDeleteDocumentQuery,
  ReembedDocumentSchema as ZReembedDocument,
};




