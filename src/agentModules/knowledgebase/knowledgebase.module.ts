// src/knowledgebase/knowledgebase.module.ts
import { Module } from '@nestjs/common';
import { KnowledgebaseController } from './knowledgebase.controller';
import { KnowledgebaseService } from './knowledgebase.service';
import { KnowledgebaseRepository } from './repository/knowledgebase.repository';
import { PrismaService } from 'src/prisma/prisma.service';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';


@Module({
  controllers: [KnowledgebaseController],
  providers: [
    KnowledgebaseService,
    KnowledgebaseRepository,
    PrismaService,
    ClerkAuthGuard
  ],
  exports: [KnowledgebaseService],
})
export class KnowledgebaseModule {}
