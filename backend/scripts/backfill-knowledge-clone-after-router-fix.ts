/**
 * Фаза 0.5 (2026-05-29) — One-time backfill после расширения router'а:
 * `expertise | experience | competence` теперь идут не только в 3-7-skill,
 * но и в 3-2-knowledge-clone. Старые блоки (созданные ДО фикса) уже
 * присутствуют в графе, но KnowledgeProfile сотрудника не был пересобран
 * по ним. Этот скрипт находит таких сотрудников и enqueue ребилд их
 * KnowledgeProfile.
 *
 * **Idempotent.** Воркер `knowledge-clone-rebuild` использует `jobId =
 * rebuild-knowledge-profile_<personId>` с debounce'ом (cfg.knowledgeClone.
 * debounceMs, default 60s) → повторный запуск backfill'а = no-op. Сам ребилд
 * читает все блоки за 12 месяцев независимо от signalType триггера, так что
 * один enqueue per Person достаточно.
 *
 * Запуск (после деплоя router fix):
 *   bun run scripts/backfill-knowledge-clone-after-router-fix.ts --dry-run
 *   bun run scripts/backfill-knowledge-clone-after-router-fix.ts
 *   bun run scripts/backfill-knowledge-clone-after-router-fix.ts --tenant=<orgId>
 *   bun run scripts/backfill-knowledge-clone-after-router-fix.ts --since=2026-01-01
 *   bun run scripts/backfill-knowledge-clone-after-router-fix.ts --limit=1000
 *
 * Источник: plans/tz/2026-05-29-agents-v2-umbrella.md §Фаза 0.5.
 */

import { NestFactory } from '@nestjs/core';
import type { SignalType } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { CoreQueueService } from '../src/modules/core-queue/core-queue.service';

import { createPrismaClient } from './_lib/prisma';

/**
 * SignalType'ы, по которым router фикс расширен. Должны совпадать с
 * router.service.ts:case 'expertise'|'experience'|'competence'.
 */
const SIGNAL_TYPES = ['expertise', 'experience', 'competence'] as const;

interface Options {
  tenantId?: string;
  since?: Date;
  limit?: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const tenantArg = argv.find((a) => a.startsWith('--tenant='));
  const sinceArg = argv.find((a) => a.startsWith('--since='));
  const limitArg = argv.find((a) => a.startsWith('--limit='));

  const opts: Options = { dryRun: argv.includes('--dry-run') };

  if (tenantArg) {
    const v = tenantArg.split('=')[1];
    if (v) opts.tenantId = v;
  }
  if (sinceArg) {
    const v = sinceArg.split('=')[1];
    if (v) {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        throw new Error(`Invalid --since date: "${v}" (expected ISO YYYY-MM-DD)`);
      }
      opts.since = d;
    }
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
    `=== backfill-knowledge-clone-after-router-fix START ` +
      `(dryRun=${opts.dryRun}, tenant=${opts.tenantId ?? '<all>'}, ` +
      `since=${opts.since?.toISOString() ?? '<all>'}, ` +
      `limit=${opts.limit ?? '<none>'}) ===`,
  );

  // Лёгкий pre-check ДО подъёма AppModule (Nest DI + Redis/BullMQ): если
  // нет сотрудников с подходящими блоками — выходим чисто, не поднимая
  // тяжёлый контекст и не требуя готовой очереди.
  const matchWhere = {
    relationship: 'employee' as const,
    deletedAt: null,
    ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
    entity: {
      blockMentions: {
        some: {
          role: 'subject' as const,
          block: {
            signalType: { in: SIGNAL_TYPES as unknown as SignalType[] },
            status: 'canonical' as const,
            ...(opts.since ? { createdAt: { gte: opts.since } } : {}),
          },
        },
      },
    },
  };
  const preCheck = createPrismaClient();
  try {
    const pending = await preCheck.person.count({ where: matchWhere });
    if (pending === 0) {
      console.log(
        'backfill-knowledge-clone-after-router-fix: нет сотрудников с expertise/experience/competence-блоками — обновление не требуется.',
      );
      return;
    }
    console.log(`backfill-knowledge-clone-after-router-fix: кандидатов ${pending}`);
  } finally {
    await preCheck.$disconnect();
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);
    const coreQueue = app.get(CoreQueueService);

    // 1. Найти employee Person'ов, у которых есть canonical-блоки с
    //    expertise/experience/competence (как subject в IdeaBlockEntity).
    //    Связь идёт `Person.entity → Entity.blockMentions → IdeaBlock`
    //    (Person → Entity через entityId — см. schema.prisma:Person/Entity).
    //    Используем nested-фильтр, чтобы Postgres не материализовывал все блоки.
    const employees = await prisma.person.findMany({
      where: matchWhere,
      select: { id: true, tenantId: true },
      ...(opts.limit ? { take: opts.limit } : {}),
    });

    console.log(
      `Found ${employees.length} employee(s) with expertise/experience/competence canonical blocks`,
    );

    if (opts.dryRun) {
      console.log('Dry-run mode: no enqueue. Exiting.');
      return;
    }

    let enqueued = 0;
    let errors = 0;
    for (const emp of employees) {
      try {
        // delayMs=0 — без debounce'а: backfill хочет «прогнать всё сейчас»,
        // а не ждать 60s. BullMQ + jobId гарантируют дедупликацию.
        await coreQueue.enqueueRebuildKnowledgeProfile({
          personId: emp.id,
          tenantId: emp.tenantId,
          reason: 'backfill-router-fix-knowledge-clone',
          delayMs: 0,
        });
        enqueued++;
        if (enqueued % 50 === 0) {
          console.log(
            `progress: enqueued=${enqueued}/${employees.length}, errors=${errors}`,
          );
        }
      } catch (err) {
        errors++;
        console.warn(
          `[error] personId=${emp.id} tenantId=${emp.tenantId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    console.log(
      `=== DONE total=${employees.length}, enqueued=${enqueued}, errors=${errors} ` +
        `(existing jobId+debounce will dedupe duplicates) ===`,
    );
  } finally {
    await app.close();
  }
}

const opts = parseArgs(process.argv.slice(2));
main(opts)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('backfill-knowledge-clone-after-router-fix FAILED:', err);
    process.exit(1);
  });
