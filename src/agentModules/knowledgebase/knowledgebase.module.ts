// src/knowledgebase/knowledgebase.module.ts
import { Module } from '@nestjs/common';
import { KnowledgebaseController } from './knowledgebase.controller';
import { KnowledgebaseService } from './knowledgebase.service';
import { KnowledgebaseRepository } from './repository/knowledgebase.repository';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';


@Module({
  controllers: [KnowledgebaseController],
  providers: [
    KnowledgebaseService,
    KnowledgebaseRepository,
    ClerkAuthGuard
  ],
  exports: [KnowledgebaseService],
})
export class KnowledgebaseModule {}
