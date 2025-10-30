// src/agent-modules/lead-custom-field-intake/lead-custom-field-intake.module.ts
import { Module } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { LeadCustomFieldIntakeRepository } from './repository/lead-custom-field-intake.repository';
import { LeadCustomFieldIntakeService } from './lead-custom-field-intake.service';
import { LeadCustomFieldIntakeController } from './lead-custom-field-intake.controller'; // if you have one

@Module({
  imports: [],
  controllers: [LeadCustomFieldIntakeController], // or []
  providers: [ LeadCustomFieldIntakeRepository, LeadCustomFieldIntakeService],
  exports: [
    LeadCustomFieldIntakeService,          // 👈 make it available to other modules
    LeadCustomFieldIntakeRepository,       // (optional) export repo too
  ],
})
export class LeadCustomFieldIntakeModule {}
