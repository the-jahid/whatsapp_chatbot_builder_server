// ===================================================
// Zod schema for GET /agents/user/:userId query
// ===================================================
import { z } from "zod";
import {
  MemoryType,
  AIModel,
  OpenAIModel,
  GeminiModel,
  ClaudeModel,
} from "@prisma/client";

/** Allowed sortable fields (keep in sync with service) */
const sortableFields = [
  "id",
  "name",
  "prompt",
  "isActive",
  "memoryType",
  "isLeadsActive",
  "isEmailActive",
  "isKnowledgebaseActive",
  "isBookingActive",
  "useOwnApiKey",
  "historyLimit",
  "modelType",
  "openAIModel",
  "geminiModel",
  "claudeModel",
  "isVoiceResponseAvailable", // NEW
  "isImageDataExtraction",    // NEW
  "createdAt",
  "updatedAt",
] as const;

const sortableSet = new Set(sortableFields);

/** Multi-sort validator, e.g. "createdAt:desc,name:asc" */
const multiSortSchema = z
  .string()
  .trim()
  .refine((val) => {
    if (!val) return false;
    return val.split(",").every((pair) => {
      const [fieldRaw, orderRaw] = pair.split(":").map((s) => s?.trim());
      const fieldOk = !!fieldRaw && sortableSet.has(fieldRaw as any);
      const order = (orderRaw || "asc").toLowerCase();
      const orderOk = order === "asc" || order === "desc";
      return fieldOk && orderOk;
    });
  }, "Invalid sort format. Use 'field:asc|desc' CSV with allowed fields.");

const csvUuidRegex =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\s*,\s*(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}))*$/i;

/** Build the base object and call .strict() BEFORE .superRefine() */
const baseGetAllAgentsQueryObject = z
  .object({
    // pagination
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),

    // sorting: either 'sort' (multi) OR (sortBy + sortOrder)
    sort: multiSortSchema.optional(),
    sortBy: z.enum(sortableFields).optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),

    // filters
    id: z.string().uuid().optional(),
    ids: z.string().trim().regex(csvUuidRegex, "ids must be a CSV of UUIDs").optional(),

    isActive: z.coerce.boolean().optional(),
    isLeadsActive: z.coerce.boolean().optional(),
    isEmailActive: z.coerce.boolean().optional(),
    isKnowledgebaseActive: z.coerce.boolean().optional(),
    isBookingActive: z.coerce.boolean().optional(),
    useOwnApiKey: z.coerce.boolean().optional(),

    // NEW feature-flag filters
    isVoiceResponseAvailable: z.coerce.boolean().optional(),
    isImageDataExtraction: z.coerce.boolean().optional(),

    memoryType: z.nativeEnum(MemoryType).optional(),
    modelType: z.nativeEnum(AIModel).optional(),
    openAIModel: z.nativeEnum(OpenAIModel).optional(),
    geminiModel: z.nativeEnum(GeminiModel).optional(),
    claudeModel: z.nativeEnum(ClaudeModel).optional(),

    historyLimit: z.coerce.number().int().min(0).optional(),

    // partial matches
    name: z.string().min(1).optional(),
    prompt: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional(), // optional text search on key

    // global search
    search: z.string().min(1).optional(),

    // date ranges
    createdAtFrom: z.coerce.date().optional(),
    createdAtTo: z.coerce.date().optional(),
    updatedAtFrom: z.coerce.date().optional(),
    updatedAtTo: z.coerce.date().optional(),
  })
  .strict();

export const getAllAgentsQuerySchema = baseGetAllAgentsQueryObject.superRefine(
  (val, ctx) => {
    // Mutually exclusive sorting styles
    if (val.sort && (val.sortBy || val.sortOrder)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Use either 'sort' OR ('sortBy' + 'sortOrder'), not both.",
        path: ["sort"],
      });
    }

    // Date range checks
    if (val.createdAtFrom && val.createdAtTo && val.createdAtFrom > val.createdAtTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "createdAtFrom must be <= createdAtTo",
        path: ["createdAtFrom"],
      });
    }
    if (val.updatedAtFrom && val.updatedAtTo && val.updatedAtFrom > val.updatedAtTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "updatedAtFrom must be <= updatedAtTo",
        path: ["updatedAtFrom"],
      });
    }
  }
);

export type GetAllAgentsQueryDto = z.infer<typeof getAllAgentsQuerySchema>;
