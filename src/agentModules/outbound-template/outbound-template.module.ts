// src/outbound-template/outbound-template.module.ts
import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import * as multer from 'multer';

import { OutboundTemplateController } from './outbound-template.controller';
import { OutboundTemplateService } from './outbound-template.service';
import { OutboundTemplateRepository } from './repository/outbound-template.repository';
import { PrismaService } from '../../prisma/prisma.service'; // <-- adjust if your path differs

@Module({
  // Ensure uploaded files are kept in memory (so we can store the Buffer in Postgres)
  imports: [
    MulterModule.register({
      storage: multer.memoryStorage(),
      limits: {
        // hard cap; service still enforces stricter per-type limits
        fileSize: 100 * 1024 * 1024, // 100 MB
      },
    }),
  ],
  controllers: [OutboundTemplateController],
  providers: [OutboundTemplateService, OutboundTemplateRepository, PrismaService],
  exports: [OutboundTemplateService, OutboundTemplateRepository],
})
export class OutboundTemplateModule {}



