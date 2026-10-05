import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  // Browsers may call the API from any address in development (web console,
  // mobile browser preview). In production only the web console may. Native
  // apps are not browsers and are unaffected. Sessions travel in a header,
  // not a cookie, so an allowed origin still needs a token.
  app.enableCors({ origin: env.NODE_ENV === 'production' ? (env.WEB_URL ?? false) : true });
  app.enableShutdownHooks();
  await app.listen(env.API_PORT);
}
await bootstrap();
