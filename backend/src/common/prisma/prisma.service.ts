import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { TypedConfigService } from '../config';

/**
 * Лог-конфиг как event-эмиттеры — чтобы слушать `query/warn/error` через `$on`
 * и логировать их единым Nest-логгером. `as const` нужен, чтобы `$on('query')`
 * был типизирован (Prisma выводит доступные события из этого литерала).
 */
const PRISMA_LOG: [
  { emit: 'event'; level: 'query' },
  { emit: 'event'; level: 'warn' },
  { emit: 'event'; level: 'error' },
] = [
  { emit: 'event', level: 'query' },
  { emit: 'event', level: 'warn' },
  { emit: 'event', level: 'error' },
];

/**
 * Расширение `PrismaClient` с lifecycle-хуками Nest.
 *
 * Prisma 7: подключение идёт через driver adapter (`@prisma/adapter-pg`),
 * connection URL берётся из `TypedConfigService` (а не из schema.prisma).
 *
 * - При старте модуля — `$connect()`.
 * - При остановке — `$disconnect()`.
 * - Логирует медленные запросы (> 500 ms) через событие `query`
 *   (в v7 middleware `$use` удалён).
 */
@Injectable()
export class PrismaService
  extends PrismaClient<{ adapter: PrismaPg; log: typeof PRISMA_LOG }>
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private static readonly SLOW_QUERY_MS = 500;

  constructor(cfg: TypedConfigService) {
    super({
      adapter: new PrismaPg({ connectionString: cfg.db.url }),
      log: PRISMA_LOG,
    });
  }

  async onModuleInit(): Promise<void> {
    this.$on('query', (e) => {
      if (e.duration > PrismaService.SLOW_QUERY_MS) {
        this.logger.warn(`Медленный Prisma-запрос: ${e.duration} ms — ${e.query}`);
      }
    });
    this.$on('warn', (e) => this.logger.warn(e.message));
    this.$on('error', (e) => this.logger.error(e.message));

    await this.$connect();
    this.logger.log('Подключение к Postgres установлено');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Подключение к Postgres закрыто');
  }
}
