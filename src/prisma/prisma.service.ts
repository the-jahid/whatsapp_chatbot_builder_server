import 'dotenv/config';
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Lazy-initialized pool and adapter
let pool: Pool | null = null;
let adapter: PrismaPg | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

function getAdapter(): PrismaPg {
  if (!adapter) {
    adapter = new PrismaPg(getPool());
  }
  return adapter;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: getAdapter() });
  }

  async onModuleInit() {
    await this.$connect();
    console.log('Database connection established.');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    if (pool) {
      await pool.end();
    }
  }
}