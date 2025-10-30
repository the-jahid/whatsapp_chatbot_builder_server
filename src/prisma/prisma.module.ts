import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global() // <-- This decorator makes the module global
@Module({
  providers: [PrismaService],
  // We export the PrismaService so it can be used by other modules
  exports: [PrismaService],
})
export class PrismaModule {}
