import {  Module} from '@nestjs/common';
import { UserModule } from './user/user.module';
import { PrismaModule } from './prisma/prisma.module';
import { ClerkModule } from './clerk/clerk.module';

import { AgentModule } from './agentModules/agent/agent.module';
import { WhatsappModule } from './agentModules/whatsapp/whatsapp.module';
import { ConversationModule } from './agentModules/conversation/conversation.module';
import { LeadItemModule } from './agentModules/lead-Item/lead-item.module';
import { LeadModule } from './agentModules/lead/lead.module';
import { GoogleApiModule } from './auth/google-api/google-api.module';
import { GoogleAuthModule } from './auth/google-auth/google-auth.module';
import { CalendarConnectionModule } from './CalendarConnection/calendar-connection.module';
import { BookingSettingsModule } from './agentModules/booking-settings/booking-settings.module';
import { AppointmentLeadItemModule } from './agentModules/appointment-lead-item/appointment-lead-item.module';

import { LeadCustomFieldIntakeModule } from './agentModules/outbound/lead-custom-field-intake/lead-custom-field-intake.module';
import { OutboundLeadModule } from './agentModules/outbound/outbound-lead/outbound-lead.module';

import { ScheduleModule } from '@nestjs/schedule';
import { OutboundCampaignModule } from './agentModules/outbound/outbound-campaign/outbound-campaign.module';
import { OutboundTemplateModule } from './agentModules/outbound-template/outbound-template.module';
import { OutboundBroadcastModule } from './agentModules/outbound/outbound-broadcast/outbound-broadcast.module';
import { KnowledgebaseModule } from './agentModules/knowledgebase/knowledgebase.module';


@Module({

  imports: [
     PrismaModule,
     UserModule,
     ClerkModule,
     AgentModule,
     WhatsappModule,
     ConversationModule,
     LeadItemModule,
     LeadModule,
     GoogleApiModule,
     GoogleAuthModule,
     CalendarConnectionModule,
     BookingSettingsModule,
     AppointmentLeadItemModule,
     LeadCustomFieldIntakeModule, 
     OutboundLeadModule,
     OutboundTemplateModule,
    OutboundCampaignModule,
    OutboundBroadcastModule,
    KnowledgebaseModule,
     ScheduleModule.forRoot()
    ],
  providers: []
})

export class AppModule {}
