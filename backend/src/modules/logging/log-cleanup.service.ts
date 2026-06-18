import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

import { LogSettingsService } from './log-settings.service';
import { LOG_CLEANUP_LOCK_KEY } from './log.constants';

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const DELETE_BATCH = 5000;
const TXN_TIMEOUT_MS = 120_000;

export interface CleanupResult {
  deleted: number;
  cutoff?: string;
  retentionDays?: number;
  skipped?: boolean;
}

@Injectable()
export class LogCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LogCleanupService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: LogSettingsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.runCleanup().catch((err) => {
        this.logger.warn(`Авто-cleanup логов упал: ${(err as Error).message}`);
      });
    }, CLEANUP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runCleanup(): Promise<CleanupResult> {
    const retentionDays = this.settings.get().retentionDays;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    return this.prisma.$transaction(
      async (tx) => {
        const lockRows = await tx.$queryRaw<Array<{ locked: boolean }>>(
          Prisma.sql`SELECT pg_try_advisory_lock(${LOG_CLEANUP_LOCK_KEY}::bigint) AS locked`,
        );
        if (!lockRows[0]?.locked) {
          return { deleted: 0, skipped: true };
        }

        try {
          let deleted = 0;
          for (;;) {
            const ids = await tx.systemLog.findMany({
              where: { createdAt: { lt: cutoff } },
              select: { id: true },
              take: DELETE_BATCH,
            });
            if (ids.length === 0) break;
            const res = await tx.systemLog.deleteMany({
              where: { id: { in: ids.map((i) => i.id) } },
            });
            deleted += res.count;
            if (ids.length < DELETE_BATCH) break;
          }
          return {
            deleted,
            cutoff: cutoff.toISOString(),
            retentionDays,
            skipped: false,
          };
        } finally {
          await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_unlock(${LOG_CLEANUP_LOCK_KEY}::bigint)`,
          );
        }
      },
      { timeout: TXN_TIMEOUT_MS, maxWait: 5_000 },
    );
  }
}
