
// ---------------------------------------------------
// 4. Module: src/conversation/conversation.module.ts
// ---------------------------------------------------
// This is a basic module definition for the Conversation entity.
// In your current setup, a dedicated service or controller for conversations
// is likely unnecessary, as conversations are created within the MessageHandlerService.
// However, if you needed to add routes for fetching conversation history,
// you would add the controller and service here.

import { Module } from '@nestjs/common';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';

@Module({
  controllers: [ConversationController], // Add ConversationController if you create one
  providers: [ConversationService],   // Add ConversationService if you create one
  exports: [ConversationService]
})
export class ConversationModule {}
