import { z } from 'zod';
import { createWhatsappSchema, updateWhatsappSchema } from '../schema/whatsapp.schema';


/**
 * The DTO type for creating a new WhatsApp entity.
 * This type is inferred directly from the `createWhatsappSchema`
 * using `z.infer`. It provides compile-time type safety.
 */
export type CreateWhatsappDto = z.infer<typeof createWhatsappSchema>;

/**
 * The DTO type for updating an existing WhatsApp entity.
 * This type is inferred directly from the `updateWhatsappSchema`
 * using `z.infer`. Since the schema is partial, all properties
 * on this type will be optional.
 */
export type UpdateWhatsappDto = z.infer<typeof updateWhatsappSchema>;

