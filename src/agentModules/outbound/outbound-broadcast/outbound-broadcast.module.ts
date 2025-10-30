import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { OutboundBroadcastService } from './outbound-broadcast.service';
import { OutboundBroadcastController } from './outbound-broadcast.controller';

import { PrismaModule } from 'src/prisma/prisma.module';
import { WhatsappModule } from 'src/agentModules/whatsapp/whatsapp.module';

@Module({
  imports: [
    PrismaModule,
    WhatsappModule,
    // If ScheduleModule.forRoot() is already in AppModule, you can remove this line.
    ScheduleModule.forRoot(),
  ],
  controllers: [OutboundBroadcastController],
  providers: [OutboundBroadcastService],
  exports: [OutboundBroadcastService], // <-- export so other modules can inject it
})
export class OutboundBroadcastModule {}
