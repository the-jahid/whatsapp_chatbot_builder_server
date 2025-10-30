import { z } from 'zod';

/** Mirror Prisma enums for runtime checks (TemplateStatus removed) */
export const TemplateMediaTypeEnum = z.enum(['NONE', 'IMAGE', 'VIDEO', 'DOCUMENT']);

/** UUID (any version) */
export const UUID_ANY = z
  .string()
  .trim()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    'Invalid UUID',
  );

export const NonEmpty = z.string().trim().min(1);

/** ------- Body schemas (used by controllers/services) ------- */
export const CreateTemplateBodySchema = z.object({
  agentId: UUID_ANY,
  name: NonEmpty,
  body: z.string().trim().default('Hello world').optional(),
  variables: z.array(z.string().trim()).default([]).optional(),
});

export const UpdateTemplateBodySchema = z.object({
  name: NonEmpty.optional(),
  body: z.string().trim().optional(),
  variables: z.array(z.string().trim()).optional(),
});

/** Media is uploaded as a file; this validates the path params/body metadata only */
export const ReplaceMediaSchema = z.object({
  id: UUID_ANY,
});

/** Optional query filter for listing */
export const QueryTemplatesSchema = z.object({
  agentId: UUID_ANY,
  q: z.string().trim().optional(),
  skip: z.coerce.number().min(0).default(0).optional(),
  take: z.coerce.number().min(1).max(200).default(50).optional(),
  orderBy: z.enum(['createdAt', 'updatedAt', 'name']).default('createdAt').optional(),
  orderDir: z.enum(['asc', 'desc']).default('desc').optional(),
});

/** Types */
export type CreateTemplateBody = z.infer<typeof CreateTemplateBodySchema>;
export type UpdateTemplateBody = z.infer<typeof UpdateTemplateBodySchema>;
export type QueryTemplates = z.infer<typeof QueryTemplatesSchema>;
