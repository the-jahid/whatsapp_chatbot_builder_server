// /src/leads/lead.module.ts

import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { LeadController } from './lead.controller';
import { LeadService } from './lead.service';


@Module({
  imports: [PrismaModule], // Import PrismaModule to make PrismaService available for injection
  controllers: [LeadController],
  providers: [LeadService],
})
export class LeadModule {}
