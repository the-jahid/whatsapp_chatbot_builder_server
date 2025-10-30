// ---------------------------------------------------
// 1. Interface: src/conversation/conversation.interface.ts
// ---------------------------------------------------
// This file defines the TypeScript interface for a Conversation object,
// ensuring type safety across your application.

import { SenderType } from '@prisma/client';

export interface IConversation {
  id: string;
  senderJid: string;
  message: string;
  senderType: SenderType;
  createdAt: Date;
  agentId: string;
}

