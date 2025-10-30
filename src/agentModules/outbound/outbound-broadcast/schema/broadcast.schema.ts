// src/modules/outbound-broadcast/schema/broadcast.schema.ts
import { z } from 'zod';

/* ----------------------------- Enums ----------------------------- */
export const BroadcastStatusEnum = z.enum([
  'DRAFT',
  'READY',
  'RUNNING',
  'PAUSED',
  'COMPLETED',
  'CANCELLED',
]);

export const BroadcastOrderByEnum = z.enum([
  'createdAt:desc',
  'createdAt:asc',
  'updatedAt:desc',
  'updatedAt:asc',
]);

/* -------------------- Numeric constraint (single-message gap) -------------------- */
/** Gap between messages (seconds). Keep in sync with Prisma default 120s. */
export const MessageGapSecondsSchema = z
  .coerce.number()
  .int()
  .min(0)               // allow immediate back-to-back if set to 0
  .max(86_400)          // cap at 24h
  .default(120);

/* ------------------------------- Create ------------------------------- */
export const CreateBroadcastSchema = z
  .object({
    outboundCampaignId: z.string().uuid(),
    isEnabled: z.coerce.boolean().optional().default(false),
    isPaused: z.coerce.boolean().optional().default(false),
    startAt: z.coerce.date().optional(), // nullable at DB; omit on create if not scheduling
    selectedTemplateId: z.string().uuid().optional().nullable(),

    messageGapSeconds: MessageGapSecondsSchema.optional(), // default 120 at DB
  })
  .strict();

export type CreateBroadcastInput = z.infer<typeof CreateBroadcastSchema>;

/* ------------------------------- Update ------------------------------- */
export const UpdateBroadcastSchema = z
  .object({
    isEnabled: z.coerce.boolean().optional(),
    isPaused: z.coerce.boolean().optional(),
    startAt: z.coerce.date().optional().nullable(),
    selectedTemplateId: z.string().uuid().optional().nullable(),

    messageGapSeconds: MessageGapSecondsSchema.optional(),

    status: BroadcastStatusEnum.optional(),
  })
  .strict();

export type UpdateBroadcastInput = z.infer<typeof UpdateBroadcastSchema>;

/* -------------------------------- Query -------------------------------- */
export const QueryBroadcastSchema = z
  .object({
    outboundCampaignId: z.string().uuid().optional(),
    status: BroadcastStatusEnum.optional(),
    isEnabled: z.coerce.boolean().optional(),
    isPaused: z.coerce.boolean().optional(),

    take: z.coerce.number().int().min(1).max(100).default(20),
    skip: z.coerce.number().int().min(0).default(0),
    cursor: z.string().uuid().optional(),
    orderBy: BroadcastOrderByEnum.default('createdAt:desc'),
  })
  .strict();

export type QueryBroadcastInput = z.infer<typeof QueryBroadcastSchema>;
