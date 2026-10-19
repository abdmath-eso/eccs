import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { StartupProblem } from './common/startup-problem.js';
import { env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('v1');
  // Behind Caddy every request arrives from inside the server; the visitor's own address is
  // the one Caddy (and the console, for the customer pages) passes on. Without this, all
  // diners would share one per-caller limit on the customer page.
  if (env.TRUST_PROXY === 'on') app.set('trust proxy', 'loopback, uniquelocal');
  // Browsers may call the API from any address in development (web console,
  // mobile browser preview). In production only the web console may. Native
  // apps are not browsers and are unaffected. Sessions travel in a header,
  // not a cookie, so an allowed origin still needs a token.
  app.enableCors({
    origin: env.NODE_ENV === 'production' ? (env.WEB_URL ?? false) : true,
    // The console's Logs page reads a CSV export's file name, how many rows it holds, and whether it was cut short.
    exposedHeaders: ['Content-Disposition', 'X-Export-Rows', 'X-Export-Truncated', 'X-Request-Id'],
  });
  app.enableShutdownHooks();
  // One line at every start, so a test server can never be mistaken for the live one.
  if (env.SAMPLE_SERVER === 'on') {
    new Logger('Start-up').warn(
      `SAMPLE_SERVER=on: a test server for sample data only. ${env.DEV_FIXED_OTP ? 'Every login code is the fixed DEV_FIXED_OTP and no SMS is sent' : 'DEV_FIXED_OTP is not set, so code logins are off'}. Never use it with real restaurants.`,
    );
  }
  await app.listen(env.API_PORT);
}

try {
  await bootstrap();
} catch (error) {
  // A reason already written in plain words is printed by itself and the server stops.
  // Anything unexpected keeps its full detail, which is what is needed to find a fault.
  if (!(error instanceof StartupProblem)) throw error;
  new Logger('Start-up').error(`The API did not start. ${error.message}`);
  process.exit(1);
}
