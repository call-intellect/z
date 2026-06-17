/**
 * Фаза 2 (2026-06-16) — Разовый идемпотентный backfill: переразметка СТАРЫХ
 * «плоских» карточек базы знаний структурным компилятором.
 *
 * Контекст:
 *   ТЗ `plans/tz/2026-06-16-knowledge-base-redesign-and-formatter-tz.md` Ф2.
 *   Фаза 1 включила структурный компилятор `compile-org-document`
 *   (StructuredDocumentCompilerService) для НОВЫХ карточек в dedupe-пути
 *   специалиста 3.1. Но карточки regulation/process/policy/instruction,
 *   созданные ДО этого, остались «плоскими» — тело без заголовков `## ` и без
 *   markdown-таблиц (`\n| `). Этот скрипт находит их и пересобирает структурным
 *   компилятором в две колонки (СОЗДАНИЕ-режим из материала карточки).
 *
 * Материал-источник по типу:
 *   - regulation / instruction → `statement ?? <тело>` (statement богаче);
 *   - policy / process         → тело (`contentMd` / `description`).
 *   Тело: contentMd у regulation/policy/instruction, description у process.
 *
 * Версионирование (зеркало Фазы 1): на каждое успешное обновление пишем новую
 *   `CardVersion` (trustTier='auto', changeReason='backfill') + обновляем тело
 *   карточки. У regulation/instruction есть колонка `version` — инкрементим её;
 *   у policy/process её нет.
 *
 * Идемпотентность (acceptance Ф2):
 *   - предикат isFlat: карточки с `## ` или markdown-таблицей пропускаются →
 *     повторный прогон = 0 обновлений.
 *   - гейт качества: пишем только если компилятор вернул ok=true, новое тело
 *     непустое, отличается от текущего И действительно структурно (есть `## `
 *     или таблица). Иначе skipNoImprove — карточка не трогается.
 *
 * Kill-switch:
 *   AdminSetting `docCompilerEnabled` (code-fallback `true`,
 *   StructuredDocumentCompilerService.isEnabled()). При OFF backfill пропущен.
 *
 * Запуск:
 *   docker compose exec backend bun run scripts/backfill-compile-flat-cards.ts --dry-run  # только counts
 *   docker compose exec backend bun run scripts/backfill-compile-flat-cards.ts             # запись (дефолт)
 *   docker compose exec backend bun run scripts/backfill-compile-flat-cards.ts --tenant=<orgId>
 *   docker compose exec backend bun run scripts/backfill-compile-flat-cards.ts --limit=500
 *
 * Регистрация: backend/scripts/apply-prod-deploy.ts (phase: 'backfill', skipBootstrap).
 */

import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { StructuredDocumentCompilerService } from '../src/modules/knowledge-core/services/structured-document-compiler.service';

import { createPrismaClient } from './_lib/prisma';
import { silenceRedisShutdownNoise } from './_lib/silence-redis-shutdown';

/** Типы карточек, которые пересобираем. */
type CardKind = 'regulation' | 'process' | 'policy' | 'instruction';

interface Options {
  tenantId?: string;
  limit?: number;
  dryRun: boolean;
}

interface Stats {
  scanned: number;
  updated: number;
  skippedStructured: number;
  skippedEmpty: number;
  skippedNoImprove: number;
  wouldUpdate: number;
  errors: number;
}

function parseArgs(argv: string[]): Options {
  const tenantArg = argv.find((a) => a.startsWith('--tenant='));
  const limitArg = argv.find((a) => a.startsWith('--limit='));

  const opts: Options = { dryRun: argv.includes('--dry-run') };

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

/**
 * Плоская карточка — тело без структуры: нет markdown-заголовка `## ` и нет
 * markdown-таблицы (строка, начинающаяся с `| `). Структурный компилятор
 * всегда выдаёт хотя бы одно из двух → так отличаем «старые» от «новых».
 */
function isFlat(body: string | null | undefined): boolean {
  const b = body ?? '';
  return !b.includes('## ') && !b.includes('\n| ');
}

/** Текущая версия карточки в CardVersion (макс) — следующая = +1. */
async function nextCardVersion(
  prisma: PrismaService,
  tenantId: string,
  resourceType: string,
  resourceId: string,
): Promise<number> {
  const last = await prisma.cardVersion.findFirst({
    where: { tenantId, resourceType, resourceId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  return (last?.version ?? 0) + 1;
}

/** Общая строка-результат строки карточки (минимальный набор для логики). */
interface CardRow {
  id: string;
  tenantId: string;
  name: string;
  dataClass: string;
  currentVersionId: string | null;
  body: string;
  statement?: string | null;
}

/**
 * Обработать один тип карточек. Хелпер параметризован по `kind`:
 *   - resourceType — тег в CardVersion;
 *   - bodyField    — поле тела ('contentMd' | 'description');
 *   - hasVersion   — есть ли колонка `version` (regulation/instruction).
 */
async function processKind(
  kind: CardKind,
  opts: Options,
  prisma: PrismaService,
  compiler: StructuredDocumentCompilerService,
  stats: Stats,
): Promise<void> {
  const resourceType = kind;
  const hasStatement = kind === 'regulation' || kind === 'instruction';

  // Выборка — единая по 4 типам, поле тела зависит от kind. Делаем typed-ветки,
  // чтобы select был корректным для каждого delegate.
  const where = opts.tenantId ? { tenantId: opts.tenantId } : {};
  const take = opts.limit;

  let rows: CardRow[];
  if (kind === 'regulation') {
    const found = await prisma.regulation.findMany({
      where,
      take,
      select: {
        id: true,
        tenantId: true,
        name: true,
        dataClass: true,
        currentVersionId: true,
        contentMd: true,
        statement: true,
      },
    });
    rows = found.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      name: r.name,
      dataClass: r.dataClass,
      currentVersionId: r.currentVersionId,
      body: r.contentMd,
      statement: r.statement,
    }));
  } else if (kind === 'instruction') {
    const found = await prisma.instruction.findMany({
      where,
      take,
      select: {
        id: true,
        tenantId: true,
        name: true,
        dataClass: true,
        currentVersionId: true,
        contentMd: true,
        statement: true,
      },
    });
    rows = found.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      name: r.name,
      dataClass: r.dataClass,
      currentVersionId: r.currentVersionId,
      body: r.contentMd,
      statement: r.statement,
    }));
  } else if (kind === 'policy') {
    const found = await prisma.policy.findMany({
      where,
      take,
      select: {
        id: true,
        tenantId: true,
        name: true,
        dataClass: true,
        currentVersionId: true,
        contentMd: true,
      },
    });
    rows = found.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      name: r.name,
      dataClass: r.dataClass,
      currentVersionId: r.currentVersionId,
      body: r.contentMd,
    }));
  } else {
    // process
    const found = await prisma.process.findMany({
      where,
      take,
      select: {
        id: true,
        tenantId: true,
        name: true,
        dataClass: true,
        currentVersionId: true,
        description: true,
      },
    });
    rows = found.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      name: r.name,
      dataClass: r.dataClass,
      currentVersionId: r.currentVersionId,
      body: r.description ?? '',
    }));
  }

  let dryRunSamples = 0;
  for (const row of rows) {
    stats.scanned++;
    try {
      const curBody = row.body ?? '';
      if (!isFlat(curBody)) {
        stats.skippedStructured++;
        continue;
      }

      // Материал-источник: для regulation/instruction предпочитаем statement.
      const material = (
        (hasStatement && row.statement ? row.statement : curBody) || ''
      ).trim();
      if (!material) {
        stats.skippedEmpty++;
        continue;
      }

      if (opts.dryRun) {
        stats.wouldUpdate++;
        if (dryRunSamples < 3) {
          dryRunSamples++;
          console.log(`[DRY-RUN] ${kind}: ${row.name} :: ${material.slice(0, 120)}`);
        }
        continue;
      }

      const res = await compiler.compile(
        {
          kind,
          name: row.name,
          newSourceBlocks: [{ name: row.name, answer: material }],
          existingContentMd: '',
        },
        {
          tenantId: row.tenantId,
          dataClass: row.dataClass as 'public' | 'internal' | 'sensitive' | 'private',
          sourceRef: null,
        },
      );

      // Гейт качества: пишем только если компилятор отработал, тело непустое,
      // изменилось И стало структурным.
      const newBody = (res.contentMd ?? '').trim();
      const structured = newBody.includes('## ') || newBody.includes('\n| ');
      if (!res.ok || !newBody || newBody === curBody || !structured) {
        stats.skippedNoImprove++;
        continue;
      }

      const newVersion = await nextCardVersion(prisma, row.tenantId, resourceType, row.id);

      await prisma.$transaction(async (tx) => {
        await tx.cardVersion.create({
          data: {
            tenantId: row.tenantId,
            resourceType,
            resourceId: row.id,
            version: newVersion,
            payload: {
              contentMd: res.contentMd,
              steps: res.steps,
              signals: res.signals,
              changeReasonText: res.changeReason,
            } as unknown as Prisma.InputJsonValue,
            changeReason: 'backfill',
            trustTier: 'auto',
            previousVersionId: row.currentVersionId,
            createdByUserId: null,
          },
        });

        // Обновление тела карточки + (для regulation/instruction) version.
        switch (kind) {
          case 'regulation':
            await tx.regulation.update({
              where: { id: row.id },
              data: { contentMd: res.contentMd, version: newVersion },
            });
            break;
          case 'instruction':
            await tx.instruction.update({
              where: { id: row.id },
              data: { contentMd: res.contentMd, version: newVersion },
            });
            break;
          case 'policy':
            await tx.policy.update({
              where: { id: row.id },
              data: { contentMd: res.contentMd },
            });
            break;
          case 'process':
            await tx.process.update({
              where: { id: row.id },
              data: { description: res.contentMd },
            });
            break;
        }
      });

      stats.updated++;
    } catch (err) {
      stats.errors++;
      console.warn(
        `[error] ${kind} id=${row.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

async function main(opts: Options): Promise<void> {
  console.log(
    `=== backfill-compile-flat-cards START ` +
      `(dryRun=${opts.dryRun}, tenant=${opts.tenantId ?? '<all>'}, ` +
      `limit=${opts.limit ?? '<none>'}) ===`,
  );

  // Лёгкий pre-check ДО подъёма AppModule (Nest DI + Redis/BullMQ): если нет
  // плоских карточек ни одного типа — выходим чисто, не поднимая тяжёлый контекст.
  const pre = createPrismaClient();
  try {
    const where = opts.tenantId ? { tenantId: opts.tenantId } : {};
    const [regs, procs, pols, instrs] = await Promise.all([
      pre.regulation.findMany({ where, select: { contentMd: true, statement: true } }),
      pre.process.findMany({ where, select: { description: true } }),
      pre.policy.findMany({ where, select: { contentMd: true } }),
      pre.instruction.findMany({ where, select: { contentMd: true, statement: true } }),
    ]);
    const flatCount =
      regs.filter((r) => isFlat(r.contentMd)).length +
      procs.filter((p) => isFlat(p.description)).length +
      pols.filter((p) => isFlat(p.contentMd)).length +
      instrs.filter((i) => isFlat(i.contentMd)).length;
    if (flatCount === 0) {
      console.log('backfill-compile-flat-cards: нечего делать (0 плоских карточек)');
      return;
    }
    console.log(`backfill-compile-flat-cards: плоских карточек ~${flatCount}`);
  } finally {
    await pre.$disconnect();
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const stats: Stats = {
    scanned: 0,
    updated: 0,
    skippedStructured: 0,
    skippedEmpty: 0,
    skippedNoImprove: 0,
    wouldUpdate: 0,
    errors: 0,
  };

  try {
    const prisma = app.get(PrismaService);
    const compiler = app.get(StructuredDocumentCompilerService);

    if (!compiler.isEnabled()) {
      console.log('docCompilerEnabled=OFF — backfill пропущен');
      return;
    }

    const kinds: CardKind[] = ['regulation', 'process', 'policy', 'instruction'];
    for (const kind of kinds) {
      await processKind(kind, opts, prisma, compiler, stats);
    }

    console.log('=== Итоги backfill-compile-flat-cards ===');
    console.log(`  scanned           : ${stats.scanned}`);
    console.log(`  updated           : ${stats.updated}`);
    console.log(`  skippedStructured : ${stats.skippedStructured}`);
    console.log(`  skippedEmpty      : ${stats.skippedEmpty}`);
    console.log(`  skippedNoImprove  : ${stats.skippedNoImprove}`);
    console.log(`  wouldUpdate       : ${stats.wouldUpdate}`);
    console.log(`  errors            : ${stats.errors}`);
    console.log(`  mode              : ${opts.dryRun ? 'DRY-RUN' : 'APPLY'}`);
  } finally {
    await app.close();
  }
}

const opts = parseArgs(process.argv.slice(2));
silenceRedisShutdownNoise();
main(opts)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('backfill-compile-flat-cards FAILED:', err);
    process.exit(1);
  });
