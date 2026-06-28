import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

import { RedisService } from '../redis/redis.service';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private pubClient?: Redis;
  private subClient?: Redis;

  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const redis = this.app.get(RedisService);
    this.pubClient = redis.client.duplicate();
    this.subClient = redis.client.duplicate();
    await Promise.all([this.ensureReady(this.pubClient), this.ensureReady(this.subClient)]);
    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }

  private async ensureReady(client: Redis): Promise<void> {
    if (client.status === 'ready') return;
    if (client.status === 'wait' || client.status === 'close' || client.status === 'end') {
      await client.connect();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      client.once('ready', resolve);
      client.once('error', reject);
    });
  }
}
