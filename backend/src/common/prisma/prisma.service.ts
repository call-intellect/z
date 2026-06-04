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
      // МТЗ «разблокировка конвейера» Ф5 — самодостаточный рантайм-пул для
      // Apache AGE. `PrismaPg` принимает `pg.Pool | pg.PoolConfig | string`
      // и при передаче объекта-конфига делает `new pg.Pool(this.config)`
      // (см. @prisma/adapter-pg PrismaPgAdapterFactory: `new pg.Pool(config)`).
      // Поэтому передаём `pg.PoolConfig` с libpq-параметром `options`:
      // `-c search_path=...` устанавливает search_path на этапе протокольного
      // согласования КАЖДОГО соединения пула (до любого запроса, без лишнего
      // round-trip и без гонки), что нужно для резолва неквалифицированного
      // `cypher()`/`agtype` (иначе Postgres 42883). `connectionString` остаётся
      // источником URL (cfg.db.url). На проде AGE предзагружен
      // (shared_preload_libraries='age'), поэтому LOAD не нужен — достаточно
      // search_path. Дублирует ALTER ROLE из postgres-init.sql на уровне
      // приложения: пул не зависит от того, прогнан ли init на этой роли.
      // Источник API: Context7 /prisma/prisma + /brianc/node-postgres
      // (PoolConfig.options — валидный libpq connection param).
      adapter: new PrismaPg({
        connectionString: cfg.db.url,
        options: '-c search_path=ag_catalog,"$user",public',
      }),
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
