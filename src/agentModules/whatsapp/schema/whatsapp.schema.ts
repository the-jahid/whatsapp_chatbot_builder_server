import { z } from 'zod';

// Base schema reflecting the Prisma model
export const whatsappSchema = z.object({
  id: z.string().uuid(),
  whatsappJid: z.string().nullable().optional(),
  whatsappName: z.string().nullable().optional(),
  // Prisma's Json type can be validated as any JSON-compatible value
  sessionData: z.any(),
  createdAt: z.date(),
  updatedAt: z.date(),
  agentId: z.string().uuid(),
});

// Schema for creating a new WhatsApp entry
export const createWhatsappSchema = whatsappSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Schema for updating an existing WhatsApp entry (all fields are optional)
export const updateWhatsappSchema = createWhatsappSchema.partial();






