// ---------------------------------------------------
// 3. DTO: src/conversation/conversation.dto.ts
// ---------------------------------------------------
// This file creates Data Transfer Object (DTO) types inferred directly
// from the Zod schemas. This avoids code duplication and keeps your
// types and validation rules perfectly in sync.

import { z } from 'zod';
import { createConversationSchema, updateConversationSchema } from '../schema/conversation.schema';

/**
 * The DTO type for creating a new Conversation.
 * Inferred from the createConversationSchema for compile-time safety.
 */
export type CreateConversationDto = z.infer<typeof createConversationSchema>;

/**
 * The DTO type for updating an existing Conversation.
 * Inferred from the updateConversationSchema. All properties are optional.
 */
export type UpdateConversationDto = z.infer<typeof updateConversationSchema>;



