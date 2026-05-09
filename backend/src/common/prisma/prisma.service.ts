import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Расширение `PrismaClient` с lifecycle-хуками Nest.
 *
 * - При старте модуля — `$connect()`.
 * - При остановке — `$disconnect()`.
 * - Логирует медленные запросы (> 500 ms) через стандартный Nest `Logger`.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private static readonly SLOW_QUERY_MS = 500;

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    // Логирование медленных запросов через Prisma middleware (`$use`).
    this.$use(async (params: Prisma.MiddlewareParams, next) => {
      const start = Date.now();
      try {
        return await next(params);
      } finally {
        const durationMs = Date.now() - start;
        if (durationMs > PrismaService.SLOW_QUERY_MS) {
          this.logger.warn(
            `Медленный Prisma-запрос: ${params.model ?? '(raw)'}.${params.action} — ${durationMs} ms`,
          );
        }
      }
    });

    await this.$connect();
    this.logger.log('Подключение к Postgres установлено');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Подключение к Postgres закрыто');
  }
}
