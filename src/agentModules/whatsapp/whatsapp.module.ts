import { Module, forwardRef } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { MessageHandlerService } from './handlers/message-handler.service';
import { RunAgentService } from './handlers/run-agent.service';
import { KnowledgebaseModule } from 'src/agentModules/knowledgebase/knowledgebase.module';

@Module({
  imports: [
    // PrismaModule not needed if @Global()
    forwardRef(() => KnowledgebaseModule),
  ],
  controllers: [WhatsappController],
  providers: [WhatsappService, MessageHandlerService, RunAgentService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
