import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import IORedis, { type Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

import { TypedConfigService } from '../config/index';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private pubClient?: Redis;
  private subClient?: Redis;

  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const cfg = this.app.get(TypedConfigService);
    const url = cfg.redis.url;
    this.pubClient = new IORedis(url, { lazyConnect: true, maxRetriesPerRequest: null });
    this.subClient = new IORedis(url, { lazyConnect: true, maxRetriesPerRequest: null });
    await Promise.all([this.pubClient.connect(), this.subClient.connect()]);
    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
