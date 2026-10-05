import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  app.enableCors({ origin: env.WEB_URL ?? true });
  app.enableShutdownHooks();
  await app.listen(env.API_PORT);
}
await bootstrap();
