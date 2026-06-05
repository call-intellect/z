import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/typed-config.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AI_USAGE_LOG_CLEANUP_LOCK_KEY } from '../ai.constants';

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // раз в час
const BATCH = 5000;
const TXN_TIMEOUT_MS = 120_000;
const DAY_MS = 86_400_000;

const DEFAULT_SCRUB_DAYS = 30;
const DEFAULT_DELETE_DAYS = 365;

export interface AiUsageLogCleanupResult {
  /** Сколько строк погашено (превью → NULL). */
  scrubbed: number;
  /** Сколько строк удалено целиком. */
  deleted: number;
  /** true, если advisory-lock занят другим инстансом — работа пропущена. */
  skipped?: boolean;
}

/**
 * Two-tier ретеншен `AiUsageLog` (ТЗ «LLM cost safety», Фаза 3).
 *
 * - **Tier-1 (рано):** гасим тяжёлые превью (`requestPreview` / `responsePreview`,
 *   до ~8 КБ `@db.Text` каждое) у строк старше `scrub_previews_after_days`
 *   (UPDATE → NULL). Строка остаётся — история стоимости (`costRub`/`costUsd`)
 *   сохраняется.
 * - **Tier-2 (поздно):** удаляем строки старше `delete_after_days` целиком.
 *
 * Паттерн — как `LogCleanupService` (LoggingModule):
 * - авто раз в час (`setInterval` + `unref`);
 * - single-flight на флот через `pg_try_advisory_lock` (lock+unlock на одном
 *   соединении внутри одной интерактивной транзакции);
 * - батчи по 5000 через `findMany(id)` + `updateMany`/`deleteMany`.
 *
 * Self-scheduling — регистрируется в `providers` AiModule (НЕ в WorkersModule).
 */
@Injectable()
export class AiUsageLogCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiUsageLogCleanupService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.runCleanup().catch((err) => {
        this.logger.warn(
          `Авто-cleanup AiUsageLog упал: ${(err as Error).message}`,
        );
      });
    }, CLEANUP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * @param now — точка отсчёта окон ретеншена (для детерминизма в тестах,
   *   default `Date.now()`).
   */
  async runCleanup(now: number = Date.now()): Promise<AiUsageLogCleanupResult> {
    const scrubDays =
      (await this.cfg?.getDynamic<number>(
        'llm.usage_log.scrub_previews_after_days',
        undefined,
        DEFAULT_SCRUB_DAYS,
      )) ?? DEFAULT_SCRUB_DAYS;
    const deleteDays =
      (await this.cfg?.getDynamic<number>(
        'llm.usage_log.delete_after_days',
        undefined,
        DEFAULT_DELETE_DAYS,
      )) ?? DEFAULT_DELETE_DAYS;

    const scrubCutoff = new Date(now - scrubDays * DAY_MS);
    const deleteCutoff = new Date(now - deleteDays * DAY_MS);

    return this.prisma.$transaction(
      async (tx) => {
        const lockRows = await tx.$queryRaw<Array<{ locked: boolean }>>(
          Prisma.sql`SELECT pg_try_advisory_lock(${AI_USAGE_LOG_CLEANUP_LOCK_KEY}::bigint) AS locked`,
        );
        if (!lockRows[0]?.locked) {
          return { scrubbed: 0, deleted: 0, skipped: true };
        }

        try {
          // Tier-1: гашение превью у строк старше scrubCutoff, где есть что гасить.
          let scrubbed = 0;
          for (;;) {
            const ids = await tx.aiUsageLog.findMany({
              where: {
                createdAt: { lt: scrubCutoff },
                OR: [
                  { requestPreview: { not: null } },
                  { responsePreview: { not: null } },
                ],
              },
              select: { id: true },
              take: BATCH,
            });
            if (ids.length === 0) break;
            const res = await tx.aiUsageLog.updateMany({
              where: { id: { in: ids.map((i) => i.id) } },
              data: { requestPreview: null, responsePreview: null },
            });
            scrubbed += res.count;
            if (ids.length < BATCH) break;
          }

          // Tier-2: удаление строк старше deleteCutoff (батчами, как SystemLog).
          let deleted = 0;
          for (;;) {
            const ids = await tx.aiUsageLog.findMany({
              where: { createdAt: { lt: deleteCutoff } },
              select: { id: true },
              take: BATCH,
            });
            if (ids.length === 0) break;
            const res = await tx.aiUsageLog.deleteMany({
              where: { id: { in: ids.map((i) => i.id) } },
            });
            deleted += res.count;
            if (ids.length < BATCH) break;
          }

          return { scrubbed, deleted };
        } finally {
          await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_unlock(${AI_USAGE_LOG_CLEANUP_LOCK_KEY}::bigint)`,
          );
        }
      },
      { timeout: TXN_TIMEOUT_MS, maxWait: 5_000 },
    );
  }
}
