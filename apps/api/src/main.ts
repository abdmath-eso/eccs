import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { StartupProblem } from './common/startup-problem.js';
import { env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
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
