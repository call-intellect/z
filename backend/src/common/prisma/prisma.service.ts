import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { TypedConfigService } from '../config';

const PRISMA_LOG: [
  { emit: 'event'; level: 'query' },
  { emit: 'event'; level: 'warn' },
  { emit: 'event'; level: 'error' },
] = [
  { emit: 'event', level: 'query' },
  { emit: 'event', level: 'warn' },
  { emit: 'event', level: 'error' },
];

@Injectable()
export class PrismaService
  extends PrismaClient<{ adapter: PrismaPg; log: typeof PRISMA_LOG }>
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private static readonly SLOW_QUERY_MS = 500;

  constructor(cfg: TypedConfigService) {
    super({
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
