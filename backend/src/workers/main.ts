import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { WorkersModule } from '../modules/ai/workers.module';

/**
 * Entry point worker-процесса.
 *
 *   bun run worker:dev   — запуск через tsx watch.
 *   bun run worker:start — запуск собранной dist/workers/main.js.
 *
 * Воркеры регистрируют BullMQ Worker'а в `onModuleInit` своих провайдеров —
 * после `createApplicationContext` они уже слушают очереди. `enableShutdownHooks`
 * закроет соединения корректно по SIGTERM/SIGINT.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkersModule, {
    bufferLogs: true,
  });
  app.enableShutdownHooks();
  Logger.log('Воркеры AI запущены и слушают очереди', 'WorkersBootstrap');
}

bootstrap().catch((err) => {
  // Не используем pino — это самый ранний этап; даём минимум шума.
  // eslint-disable-next-line no-console
  console.error('Worker bootstrap failed:', err);
  process.exit(1);
});
