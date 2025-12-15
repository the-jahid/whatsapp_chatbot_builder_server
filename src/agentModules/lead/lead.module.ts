// /src/leads/lead.module.ts

import { Module } from '@nestjs/common';
import { LeadController } from './lead.controller';
import { LeadService } from './lead.service';


@Module({
  imports: [], // PrismaModule not needed as it's @Global()
  controllers: [LeadController],
  providers: [LeadService],
})
export class LeadModule { }
