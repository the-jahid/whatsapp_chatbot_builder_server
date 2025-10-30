import { Prisma } from '@prisma/client';

export interface IWhatsapp {
  id: string;
  whatsappJid?: string | null;
  whatsappName?: string | null;
  sessionData: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
  agentId: string;
}