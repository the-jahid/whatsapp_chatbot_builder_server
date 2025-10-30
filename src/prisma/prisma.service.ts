import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';


@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    // This method is called automatically when the module is initialized.
    await this.$connect();
    console.log('Database connection established.');
  }
}