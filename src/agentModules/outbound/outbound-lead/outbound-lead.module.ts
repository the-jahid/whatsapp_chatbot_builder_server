import { Module, forwardRef } from '@nestjs/common';

import { OutboundLeadService } from './outbound-lead.service';
import { OutboundLeadRepository } from './repository/outbound-lead.repository';
import { OutboundLeadController } from './outbound-lead.controller';

import { LeadCustomFieldIntakeModule } from '../lead-custom-field-intake/lead-custom-field-intake.module';
import { OutboundBroadcastModule } from '../outbound-broadcast/outbound-broadcast.module';

// ⬇️ import the module that provides OutboundBroadcastService


@Module({
  imports: [
    LeadCustomFieldIntakeModule,
    // forwardRef is safe here; remove forwardRef if you prefer (no cycle currently).
    forwardRef(() => OutboundBroadcastModule),
  ],
  controllers: [OutboundLeadController],
  providers: [OutboundLeadService, OutboundLeadRepository],
  exports: [OutboundLeadService, OutboundLeadRepository],
})
export class OutboundLeadModule { }
