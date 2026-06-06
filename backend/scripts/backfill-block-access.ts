/**
 * Ф3 (knowledge-access-groups-and-provenance, 2026-06-06) — Backfill групп
 * доступа (`IdeaBlockAccess`) для исторических canonical-блоков.
 *
 * Контекст:
 *   ТЗ `plans/tz/2026-06-06-knowledge-access-groups-and-provenance.md` Фаза 3.
 *   Решение владельца В5: историческое знание = «открыто» (дефолт памяти). Поэтому
 *   ПО УМОЛЧАНИЮ (без флага `--departments`) скрипт НИЧЕГО не делает — старым блокам
 *   group-строки не назначаются (=открыты всем). closed-группы задним числом НЕ
 *   назначаются НИКОГДА (нет источника правды о закрытости постфактум).
 *
 *   С флагом `--departments` — для canonical-блоков БЕЗ единой `IdeaBlockAccess`
 *   выводит ТОЛЬКО department-группы из уже существующих functional axisLabels
 *   (+ отделы участников/автора, если payload/subject доступны). Логику резолва
 *   НЕ дублируем — зовём `BlockAccessDeriverService.deriveDepartmentsOnly`.
 *
 * Идемпотентность:
 *   - Кандидаты — только блоки без `IdeaBlockAccess` (`blockAccess: { none: {} }`) →
 *     повторный прогон = 0 кандидатов = no-op (если у блока появилась хоть одна
 *     access-строка, он выпадает из выборки).
 *   - createMany skipDuplicates по @@id([blockId, groupId]) — страховка от гонки.
 *   - Курсорная пагинация по id (обработанные блоки выпадают из where → курсор
 *     обязателен, иначе бесконечный цикл на блоках-«пропусках» без домена).
 *
 * Запуск:
 *   docker compose exec backend bun run scripts/backfill-block-access.ts            # no-op (исторические = открыты)
 *   docker compose exec backend bun run scripts/backfill-block-access.ts --departments --dry-run
 *   docker compose exec backend bun run scripts/backfill-block-access.ts --departments
 *   docker compose exec backend bun run scripts/backfill-block-access.ts --departments --tenant=<orgId>
 *   docker compose exec backend bun run scripts/backfill-block-access.ts --departments --limit=5000
 *
 * Регистрация: backend/scripts/apply-prod-deploy.ts (phase: 'backfill', skipBootstrap, args=['--departments']).
 */

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { BlockAccessDeriverService } from '../src/modules/knowledge-core/services/block-access-deriver.service';
import { S3Service } from '../src/modules/recordings/s3.service';

import { createPrismaClient } from './_lib/prisma';
import { silenceRedisShutdownNoise } from './_lib/silence-redis-shutdown';

const BATCH_SIZE = 200;

interface Options {
  tenantId?: string;
  limit?: number;
  dryRun: boolean;
  /** Без этого флага — no-op (исторические блоки остаются открытыми, В5). */
  departments: boolean;
}

interface Stats {
  scanned: number;
  derived: number;
  skipped: number;
}

function parseArgs(argv: string[]): Options {
  const tenantArg = argv.find((a) => a.startsWith('--tenant='));
  const limitArg = argv.find((a) => a.startsWith('--limit='));

  const opts: Options = {
    dryRun: argv.includes('--dry-run'),
    departments: argv.includes('--departments'),
  };

  if (tenantArg) {
    const v = tenantArg.split('=')[1];
    if (v) opts.tenantId = v;
  }
  if (limitArg) {
    const v = limitArg.split('=')[1];
    if (v) {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`Invalid --limit value: "${v}" (expected positive integer)`);
      }
      opts.limit = Math.floor(n);
    }
  }
  return opts;
}

async function main(opts: Options): Promise<void> {
  console.log(
    `=== backfill-block-access START ` +
      `(departments=${opts.departments}, dryRun=${opts.dryRun}, ` +
      `tenant=${opts.tenantId ?? '<all>'}, limit=${opts.limit ?? '<none>'}) ===`,
  );

  // В5 — без --departments историческое знание остаётся «открыто» (дефолт памяти).
  // Скрипт регистрируется в STEPS, чтобы прогон через apply-prod-deploy был
  // осмысленным, но без флага он сознательно no-op.
  if (!opts.departments) {
    console.log(
      'backfill-block-access: флаг --departments не передан — историческое знание ' +
        'остаётся «открыто всей компании» (решение В5). Ничего не делаем (no-op).',
    );
    return;
  }

  // Кандидаты — canonical-блоки БЕЗ единой access-строки (идемпотентность +
  // инкрементальность).
  const blockWhere = {
    status: 'canonical' as const,
    blockAccess: { none: {} },
    ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
  };

  // Лёгкий pre-check ДО подъёма AppModule.
  const preCheck = createPrismaClient();
  try {
    const pending = await preCheck.ideaBlock.count({ where: blockWhere });
    if (pending === 0) {
      console.log(
        'backfill-block-access: нет canonical-блоков без IdeaBlockAccess — backfill не требуется.',
      );
      return;
    }
    console.log(`backfill-block-access: кандидатов-блоков ${pending}`);
  } finally {
    await preCheck.$disconnect();
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const stats: Stats = { scanned: 0, derived: 0, skipped: 0 };

  try {
    const prisma = app.get(PrismaService);
    const deriver = app.get(BlockAccessDeriverService);
    const s3 = app.get(S3Service);

    // Кэш payload по rawEventId (участники резолвятся из payload).
    const payloadCache = new Map<string, unknown>();
    const loadPayload = async (event: {
      id: string;
      payloadStorage: string;
      payload: unknown;
      payloadS3Key: string | null;
    }): Promise<unknown> => {
      if (payloadCache.has(event.id)) return payloadCache.get(event.id);
      let result: unknown;
      if (event.payloadStorage === 's3') {
        if (!event.payloadS3Key) {
          throw new Error(`RawEvent ${event.id}: payloadStorage=s3, но payloadS3Key пустой`);
        }
        result = await s3.getJson<unknown>(event.payloadS3Key);
      } else {
        result = event.payload;
      }
      payloadCache.set(event.id, result);
      return result;
    };

    let cursorId: string | undefined = undefined;
    let processed = 0;
    while (true) {
      if (opts.limit && processed >= opts.limit) break;
      const take = opts.limit ? Math.min(BATCH_SIZE, opts.limit - processed) : BATCH_SIZE;

      const batch = await prisma.ideaBlock.findMany({
        where: blockWhere,
        select: { id: true, tenantId: true },
        orderBy: { id: 'asc' },
        take,
        ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
      });
      if (batch.length === 0) break;

      for (const block of batch) {
        stats.scanned++;
        processed++;
        try {
          // payload первого evidence блока (для отделов участников). Не критично:
          // department-путь работает и без payload (functional axisLabels + subject).
          let payload: unknown = null;
          const evidence = await prisma.ideaBlockEvidence.findFirst({
            where: { blockId: block.id },
            orderBy: { createdAt: 'asc' },
            select: { rawEventId: true },
          });
          if (evidence) {
            const event = await prisma.rawEvent.findUnique({
              where: { id: evidence.rawEventId },
              select: {
                id: true,
                payloadStorage: true,
                payload: true,
                payloadS3Key: true,
              },
            });
            if (event) payload = await loadPayload(event);
          }

          if (opts.dryRun) {
            console.log(
              `[DRY-RUN] would deriveDepartmentsOnly blockId=${block.id} tenantId=${block.tenantId}`,
            );
            stats.derived++;
            continue;
          }

          await deriver.deriveDepartmentsOnly({
            tenantId: block.tenantId,
            blockId: block.id,
            payload,
          });
          stats.derived++;
        } catch (err) {
          stats.skipped++;
          console.warn(
            `[error] blockId=${block.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      cursorId = batch[batch.length - 1]?.id;
      if (batch.length < take) break;
    }

    console.log('=== Итоги backfill-block-access ===');
    console.log(`  scanned : ${stats.scanned}`);
    console.log(`  derived : ${stats.derived}`);
    console.log(`  skipped : ${stats.skipped}`);
    console.log(`  mode    : ${opts.dryRun ? 'DRY-RUN' : 'APPLY'}`);
  } finally {
    await app.close();
  }
}

const opts = parseArgs(process.argv.slice(2));
silenceRedisShutdownNoise();
main(opts)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('backfill-block-access FAILED:', err);
    process.exit(1);
  });
