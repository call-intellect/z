import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

import { LogSettingsService } from './log-settings.service';
import { LogStreamGateway } from './log-stream.gateway';

export type SystemLogEntry = Prisma.SystemLogCreateManyInput;

const DOWNGRADE_LEVELS = new Set(['DEBUG', 'INFO', 'WARN']);

@Injectable()
export class LogBufferService implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(LogBufferService.name);
  private buffer: SystemLogEntry[] = [];
  private flushing = false;
  private timer: NodeJS.Timeout | null = null;
  private droppedSinceLastWarn = 0;
  private inErrorState = false;

  @Optional()
  @Inject(LogStreamGateway)
  private readonly stream: LogStreamGateway | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: LogSettingsService,
  ) {}

  onModuleInit(): void {
    const { flushIntervalMs } = this.settings.get();
    this.timer = setInterval(() => {
      void this.flush();
    }, flushIntervalMs);
    this.timer.unref();
  }

  async beforeApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  size(): number {
    return this.buffer.length;
  }

  enqueue(entry: SystemLogEntry): void {
    const { maxBufferSize, batchSize } = this.settings.get();

    if (this.buffer.length >= maxBufferSize) {
      this.evictOne();
    }

    this.buffer.push(entry);

    if (this.buffer.length >= batchSize) {
      void this.flush();
    }
  }

  private evictOne(): void {
    let idx = this.buffer.findIndex((e) => DOWNGRADE_LEVELS.has(String(e.level)));
    if (idx === -1) idx = 0;
    this.buffer.splice(idx, 1);
    this.droppedSinceLastWarn += 1;
    if (this.droppedSinceLastWarn === 1 || this.droppedSinceLastWarn % 1000 === 0) {
      this.logger.warn(`Буфер логов переполнен — отброшено записей: ${this.droppedSinceLastWarn}.`);
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    if (this.buffer.length === 0) return;
    this.flushing = true;

    const batch = this.buffer.splice(0, this.buffer.length);
    try {
      await this.prisma.systemLog.createMany({ data: batch });
      try {
        this.stream?.broadcast(batch);
      } catch {}
      if (this.inErrorState) {
        this.inErrorState = false;
        this.droppedSinceLastWarn = 0;
        this.logger.log('Запись логов в БД восстановлена.');
      }
    } catch (err) {
      const { maxBufferSize } = this.settings.get();
      this.buffer = [...batch, ...this.buffer].slice(0, maxBufferSize);
      if (!this.inErrorState) {
        this.inErrorState = true;
        this.logger.warn(
          `Не удалось записать пачку логов (${batch.length}) в БД: ${(err as Error).message}. Повтор позже.`,
        );
      }
    } finally {
      this.flushing = false;
    }
  }
}
