import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
  Logger,
} from '@nestjs/common';
import IORedis, { type Redis } from 'ioredis';

import { TypedConfigService } from '../config/index';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private redis: Redis | null = null;

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

  get client(): Redis {
    if (!this.redis) {
      throw new Error('RedisService: client used before onModuleInit()');
    }
    return this.redis;
  }

  async onModuleInit(): Promise<void> {
    this.redis = new IORedis(this.cfg.redis.url, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });

    this.redis.on('error', (err: Error) => {
      this.logger.error(`Redis error: ${err.message}`);
    });

    await this.redis.connect();
    this.logger.log('Подключение к Redis установлено');
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.quit();
      this.logger.log('Подключение к Redis закрыто');
    } catch (err) {
      this.logger.warn(
        `Ошибка при закрытии Redis: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.redis = null;
    }
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }
}
