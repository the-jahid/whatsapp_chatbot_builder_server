// ===================================================
// src/agent/dto/agent.dto.ts
// DTO types inferred from Zod + helpers to map UI -> server DTO
// (now includes isVoiceResponseAvailable & isImageDataExtraction)
// ===================================================
import { z } from "zod";
import {
  agentSchema,
  createAgentSchema,        // server-side: includes userId, userProvidedApiKey
  createAgentInputSchema,  // UI payload: may contain `apiKey` alias
  updateAgentSchema,       // patch payload: supports `apiKey` alias
} from "../schemas/agent.schema";
import { getAllAgentsQuerySchema } from "../schemas/agent.query.schema";

/** ---------- Types inferred from Zod ----------
 * These now include:
 *  - isVoiceResponseAvailable: boolean
 *  - isImageDataExtraction: boolean
 * thanks to the updated schemas.
 */
export type AgentDto = z.infer<typeof agentSchema>;
export type CreateAgentDto = z.infer<typeof createAgentSchema>;
export type CreateAgentInputDto = z.infer<typeof createAgentInputSchema>;
export type UpdateAgentDto = z.infer<typeof updateAgentSchema>;
export type GetAllAgentsQueryDto = z.infer<typeof getAllAgentsQuerySchema>;

/** ---------- Basic parse helpers ---------- */
export const parseCreateAgent = (data: unknown): CreateAgentDto =>
  createAgentSchema.parse(data);

export const parseCreateAgentInput = (data: unknown): CreateAgentInputDto =>
  createAgentInputSchema.parse(data);

export const parseUpdateAgent = (data: unknown): UpdateAgentDto =>
  updateAgentSchema.parse(data);

export const parseGetAllAgentsQuery = (query: unknown): GetAllAgentsQueryDto =>
  getAllAgentsQuerySchema.parse(query);

/** ---------- Convenience mappers ---------- */
/**
 * Map raw UI payload -> validated server DTO.
 * Injects userId and converts apiKey -> userProvidedApiKey.
 * Also preserves new feature flags as-is (handled by schema defaults/validation).
 */
export const toCreateAgentDto = (
  input: unknown,
  userId: string
): CreateAgentDto => {
  // Parse UI payload first (normalizes provider/models, sets defaults incl. flags)
  const parsed = createAgentInputSchema.parse(input);

  // Map UI alias `apiKey` -> server field `userProvidedApiKey`
  const userProvidedApiKey =
    parsed.apiKey && parsed.apiKey.trim().length
      ? parsed.apiKey.trim()
      : undefined;

  // Build final server DTO (schema enforces useOwnApiKey requirement)
  return createAgentSchema.parse({
    ...parsed,
    userId,
    userProvidedApiKey,
  });
};

/**
 * Normalize update patch and convert apiKey -> userProvidedApiKey if present.
 * Also re-validate after alias mapping.
 */
export const toUpdateAgentDto = (input: unknown): UpdateAgentDto => {
  // First pass: apply transforms (e.g., vendor model cleanup when modelType provided)
  const first = updateAgentSchema.parse(input);

  // If UI sends `apiKey`, map it to `userProvidedApiKey`
  const hasApiKey =
    !!input &&
    typeof input === "object" &&
    Object.prototype.hasOwnProperty.call(input as object, "apiKey");

  const k =
    hasApiKey && typeof (input as any).apiKey === "string"
      ? (input as any).apiKey.trim()
      : undefined;

  const merged: any = { ...first };
  if (hasApiKey) {
    merged.userProvidedApiKey = k && k.length ? k : null;
    delete merged.apiKey; // ensure alias not persisted further
  }

  // Final pass: validate merged shape against schema rules
  return updateAgentSchema.parse(merged);
};
