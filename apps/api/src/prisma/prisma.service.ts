import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createPrismaClient, type PrismaClient } from '@eccs/db';
import { StartupProblem } from '../common/startup-problem.js';
import { env } from '../config/env.js';

/** How long the start-up check waits for the database to answer one trivial question. */
const STARTUP_CHECK_MS = 8_000;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient = createPrismaClient(env.DATABASE_URL);

  /**
   * Asks the database one trivial question before the server starts taking
   * requests, and stops with a plain sentence if no answer comes.
   *
   * Why: on 13 Oct 2026 Docker Desktop was open but its engine had stopped. The
   * database's port still accepted connections and then said nothing, so the
   * server waited for ever during start-up, never listened, and printed no
   * reason; the app could only say "could not reach the server". A server with
   * no database can do nothing useful, so it is better to stop and say why.
   */
  async onModuleInit() {
    let timer: NodeJS.Timeout | undefined;
    const tooSlow = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer within ${STARTUP_CHECK_MS / 1000} seconds`)), STARTUP_CHECK_MS);
    });
    try {
      await Promise.race([this.client.$queryRaw`SELECT 1`, tooSlow]);
    } catch (error) {
      const message =
        `Could not reach the database at ${databaseAddress()} (${String(error instanceof Error ? error.message : error).split('\n')[0]}). ` +
        'On this PC that usually means Docker Desktop is not running, or it is open but its engine has stopped: ' +
        'quit Docker Desktop, open it again, wait until it says the engine is running, then start the API again.';
      throw new StartupProblem(message);
    } finally {
      clearTimeout(timer);
    }
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}

/** Where the database is, without the user name and password that the full address carries. */
function databaseAddress(): string {
  try {
    const url = new URL(env.DATABASE_URL);
    return `${url.hostname}:${url.port || '5432'}`;
  } catch {
    return 'the address in DATABASE_URL';
  }
}
