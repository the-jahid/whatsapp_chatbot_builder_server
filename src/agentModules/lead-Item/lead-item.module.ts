// src/lead-item/lead-item.module.ts

import { Module } from '@nestjs/common';
import { LeadItemService } from './lead-item.service';
import { LeadItemController } from './lead-item.controller';

@Module({
  controllers: [LeadItemController],
  providers: [LeadItemService],
  // Export the service if it needs to be injected into other modules
  exports: [LeadItemService],
})
export class LeadItemModule {}
