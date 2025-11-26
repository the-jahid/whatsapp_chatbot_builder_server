import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { OutboundBroadcastService } from './outbound-broadcast.service';
import { OutboundBroadcastController } from './outbound-broadcast.controller';

import { PrismaModule } from 'src/prisma/prisma.module';
import { WhatsappModule } from 'src/agentModules/whatsapp/whatsapp.module';
import { ConversationModule } from 'src/agentModules/conversation/conversation.module';

@Module({
  imports: [
    PrismaModule,
    WhatsappModule,
    ConversationModule,      // <-- add this
    // If ScheduleModule.forRoot() is already called in AppModule, remove this line here.
    ScheduleModule.forRoot(),
  ],
  controllers: [OutboundBroadcastController],
  providers: [OutboundBroadcastService],
  exports: [OutboundBroadcastService],
})
export class OutboundBroadcastModule {}

