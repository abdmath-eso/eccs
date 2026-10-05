import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createPrismaClient, type PrismaClient } from '@eccs/db';
import { env } from '../config/env.js';

@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient = createPrismaClient(env.DATABASE_URL);

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
