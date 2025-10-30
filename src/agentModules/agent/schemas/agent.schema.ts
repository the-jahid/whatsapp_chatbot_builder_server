// ===================================================
// src/agent/schemas/agent.schema.ts
// (adds historyLimit + keeps UI/server shapes separate,
//  fixes .omit on a ZodObject, and normalizes provider/model fields)
// ===================================================
import { z } from "zod";
import {
  MemoryType,
  AIModel,
  OpenAIModel,
  GeminiModel,
  ClaudeModel,
} from "@prisma/client";

/* ----------------- DB shape you return to clients ----------------- */
export const agentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  prompt: z.string().nullable(),

  isActive: z.boolean(),
  isLeadsActive: z.boolean(),
  isEmailActive: z.boolean(),

  /** NEW feature flags surfaced to clients */
  isVoiceResponseAvailable: z.boolean(),
  isImageDataExtraction: z.boolean(),

  createdAt: z.date(),
  updatedAt: z.date(),
  userId: z.string().uuid(),

  memoryType: z.nativeEnum(MemoryType),

  /** Max number of past messages to read when memoryType = BUFFER */
  historyLimit: z.number().int().min(0),

  isKnowledgebaseActive: z.boolean(),
  isBookingActive: z.boolean(),

  modelType: z.nativeEnum(AIModel),
  useOwnApiKey: z.boolean(),
  userProvidedApiKey: z.string().nullable(),

  // Selected vendor model (only one should be non-null depending on modelType)
  openAIModel: z.nativeEnum(OpenAIModel).nullable(),
  geminiModel: z.nativeEnum(GeminiModel).nullable(),
  claudeModel: z.nativeEnum(ClaudeModel).nullable(),
});

/* ----------------- Helper: normalize provider/models ----------------- */
function normalizeProvider<
  T extends {
    modelType?: AIModel | null;
    openAIModel?: OpenAIModel | null;
    geminiModel?: GeminiModel | null;
    claudeModel?: ClaudeModel | null;
  }
>(v: T) {
  const modelType = v.modelType ?? AIModel.CHATGPT;
  return {
    ...v,
    modelType,
    openAIModel: modelType === AIModel.CHATGPT ? (v.openAIModel ?? null) : null,
    geminiModel: modelType === AIModel.GEMINI ? (v.geminiModel ?? null) : null,
    claudeModel: modelType === AIModel.CLAUDE ? (v.claudeModel ?? null) : null,
  };
}

/* ----------------- 1) Base create (plain ZodObject, no transform) ----------------- */
/** UI payload core (no userId here). */
const createAgentCore = z.object({
  name: z.string().min(1, "name is required"),
  memoryType: z.nativeEnum(MemoryType),

  // UI fields
  prompt: z.string().optional().nullable(),
  /** UI alias; will be mapped to userProvidedApiKey server-side */
  apiKey: z.string().optional().nullable(),

  // switches
  isActive: z.boolean().default(true),
  isLeadsActive: z.boolean().default(false),
  isEmailActive: z.boolean().default(false),

  /** NEW feature flags (UI defaults) */
  isVoiceResponseAvailable: z.boolean().default(false),
  isImageDataExtraction: z.boolean().default(false),

  /** Default number of messages to keep in BUFFER memory */
  historyLimit: z.number().int().min(0).default(20),

  // provider (optional; defaults handled in transform)
  modelType: z.nativeEnum(AIModel).optional(),

  // vendor models (optional/nullable)
  openAIModel: z.nativeEnum(OpenAIModel).optional().nullable(),
  geminiModel: z.nativeEnum(GeminiModel).optional().nullable(),
  claudeModel: z.nativeEnum(ClaudeModel).optional().nullable(),

  /** If true, apiKey (UI) / userProvidedApiKey (server) must be present */
  useOwnApiKey: z.boolean().optional(),
});

/* ----------------- 2) UI payload (NO userId). Transform after. ----------------- */
export const createAgentInputSchema = createAgentCore
  .superRefine((v, ctx) => {
    if (v.useOwnApiKey && (!v.apiKey || v.apiKey.trim() === "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "apiKey is required when useOwnApiKey is true",
        path: ["apiKey"],
      });
    }
  })
  .transform(normalizeProvider);

/* ----------------- 3) Server DTO (HAS userId; NO apiKey alias). ----------------- */
export const createAgentSchema = createAgentCore
  .omit({ apiKey: true }) // works because it's still a ZodObject
  .extend({
    userId: z.string().uuid(),
    userProvidedApiKey: z.string().optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.useOwnApiKey && (!v.userProvidedApiKey || v.userProvidedApiKey.trim() === "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "userProvidedApiKey is required when useOwnApiKey is true",
        path: ["userProvidedApiKey"],
      });
    }
  })
  .transform(normalizeProvider);

/* ----------------- 4) Update schema ----------------- */
export const updateAgentSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    memoryType: z.nativeEnum(MemoryType).optional(),
    prompt: z.string().optional().nullable(),

    /** UI alias for updating the user-provided key */
    apiKey: z.string().optional().nullable(),

    isActive: z.boolean().optional(),
    isLeadsActive: z.boolean().optional(),
    isEmailActive: z.boolean().optional(),

    /** NEW feature flags (partial updates allowed) */
    isVoiceResponseAvailable: z.boolean().optional(),
    isImageDataExtraction: z.boolean().optional(),

    /** Update the BUFFER memory window size */
    historyLimit: z.number().int().min(0).optional(),

    modelType: z.nativeEnum(AIModel).optional(),
    openAIModel: z.nativeEnum(OpenAIModel).optional().nullable(),
    geminiModel: z.nativeEnum(GeminiModel).optional().nullable(),
    claudeModel: z.nativeEnum(ClaudeModel).optional().nullable(),

    useOwnApiKey: z.boolean().optional(),
    /** Server-side storage field */
    userProvidedApiKey: z.string().optional().nullable(),
  })
  .superRefine((v, ctx) => {
    // If caller explicitly turns on useOwnApiKey, require a key in this request.
    if (v.useOwnApiKey === true) {
      const provided =
        (typeof v.apiKey === "string" && v.apiKey.trim() !== "") ||
        (typeof v.userProvidedApiKey === "string" && v.userProvidedApiKey.trim() !== "");
      if (!provided) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Provide apiKey or userProvidedApiKey when enabling useOwnApiKey",
          path: ["useOwnApiKey"],
        });
      }
    }
  })
  .transform((v) => {
    // Keep only the model corresponding to modelType, null the others
    if (!v.modelType) return v;
    const clean: any = { ...v };
    if (v.modelType !== AIModel.CHATGPT) clean.openAIModel = null;
    if (v.modelType !== AIModel.GEMINI) clean.geminiModel = null;
    if (v.modelType !== AIModel.CLAUDE) clean.claudeModel = null;
    return clean;
  });

/* ----------------- Optional exported TS types ----------------- */
export type AgentSchema = z.infer<typeof agentSchema>;
export type CreateAgentInputSchema = z.infer<typeof createAgentInputSchema>;
export type CreateAgentSchema = z.infer<typeof createAgentSchema>;
export type UpdateAgentSchema = z.infer<typeof updateAgentSchema>;
