/**
 * ТЗ 2026-05-25 clone-reliability-hardening, Фаза 4 — backfill
 * семантического индекса `PersonKnowledgeCategoryEmbedding`.
 *
 * Контекст:
 *   Внедрена таблица `PersonKnowledgeCategoryEmbedding` для запросов
 *   «кто разбирается в X». Новые/пересобираемые профили заполняют её
 *   автоматически (`Specialist32Service.rebuildCategoryEmbeddings`).
 *   Существующие Person'ы с уже построенным `knowledgeProfile` нужно
 *   проиндексировать единоразово.
 *
 * Логика:
 *   1. Курсор-пагинация по `Person` где `knowledgeProfile IS NOT NULL`,
 *      `relationship='employee'`, `deletedAt IS NULL`.
 *   2. Для каждого Person'а:
 *      a. Парсим `knowledgeProfile` → categories.
 *      b. Удаляем все старые embedding-строки этого Person'а.
 *      c. Для каждой категории считаем embedding и пишем строку.
 *
 * Идемпотентность:
 *   На каждый Person сначала deleteMany, затем создание заново. Повторный
 *   запуск даёт тот же результат (но дороже по LLM-quota — есть
 *   `--skip-existing` для пропуска Person'ов, у которых embedding'и уже есть).
 *
 * Запуск:
 *   bun run scripts/person-knowledge-embeddings-backfill.ts
 *   bun run scripts/person-knowledge-embeddings-backfill.ts --dry-run
 *   bun run scripts/person-knowledge-embeddings-backfill.ts --skip-existing
 */

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import {
  Specialist32Service,
  type SerializedKnowledgeProfile,
} from '../src/modules/knowledge-core/services/specialist-3-2-knowledge-clone.service';

interface RunArgs {
  dryRun: boolean;
  skipExisting: boolean;
}

interface Stats {
  processed: number;
  skipped: number;
  builtTotal: number;
  errors: number;
}

function parseArgs(): RunArgs {
  const argv = process.argv.slice(2);
  return {
    dryRun: argv.includes('--dry-run'),
    skipExisting: argv.includes('--skip-existing'),
  };
}

function parseProfile(raw: unknown): SerializedKnowledgeProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const categoriesRaw = Array.isArray(obj.categories) ? obj.categories : [];
  const highlightsRaw = Array.isArray(obj.experienceHighlights)
    ? obj.experienceHighlights
    : [];
  const categories: SerializedKnowledgeProfile['categories'] = [];
  for (const c of categoriesRaw) {
    if (!c || typeof c !== 'object') continue;
    const cat = c as Record<string, unknown>;
    if (typeof cat.name !== 'string' || cat.name.length < 2) continue;
    const conf =
      cat.confidence === 'low' ||
      cat.confidence === 'medium' ||
      cat.confidence === 'high'
        ? cat.confidence
        : 'low';
    const sampleStatements: Array<{ quote: string; blockId: string }> = [];
    if (Array.isArray(cat.sampleStatements)) {
      for (const s of cat.sampleStatements.slice(0, 3)) {
        if (!s || typeof s !== 'object') continue;
        const st = s as Record<string, unknown>;
        if (typeof st.quote === 'string' && typeof st.blockId === 'string') {
          sampleStatements.push({ quote: st.quote, blockId: st.blockId });
        }
      }
    }
    const relatedEntityIds: string[] = [];
    if (Array.isArray(cat.relatedEntityIds)) {
      for (const id of cat.relatedEntityIds) {
        if (typeof id === 'string') relatedEntityIds.push(id);
      }
    }
    categories.push({
      name: cat.name,
      confidence: conf,
      observationCount:
        typeof cat.observationCount === 'number' ? cat.observationCount : 1,
      sampleStatements,
      relatedEntityIds,
      lastObservedAt:
        typeof cat.lastObservedAt === 'string'
          ? cat.lastObservedAt
          : new Date().toISOString(),
    });
  }
  if (categories.length === 0) return null;
  const version = typeof obj.version === 'number' ? obj.version : 1;
  const builtAt =
    typeof obj.builtAt === 'string' ? obj.builtAt : new Date().toISOString();
  return {
    version,
    builtAt,
    categories,
    experienceHighlights: highlightsRaw as SerializedKnowledgeProfile['experienceHighlights'],
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const prisma = app.get(PrismaService);
  const specialist = app.get(Specialist32Service);

  const stats: Stats = {
    processed: 0,
    skipped: 0,
    builtTotal: 0,
    errors: 0,
  };

  console.log(
    `[backfill] start, args=${JSON.stringify(args)} (idempotent — повторный запуск безопасен)`,
  );

  const BATCH = 50;
  let cursor: string | undefined = undefined;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const persons: Array<{
      id: string;
      tenantId: string;
      name: string;
      knowledgeProfile: unknown;
      profileBuildVersion: number;
    }> = await prisma.person.findMany({
      where: {
        deletedAt: null,
        relationship: 'employee',
        knowledgeProfile: { not: undefined as never },
        NOT: { knowledgeProfile: { equals: null as never } },
      },
      select: {
        id: true,
        tenantId: true,
        name: true,
        knowledgeProfile: true,
        profileBuildVersion: true,
      },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (persons.length === 0) break;
    const last = persons[persons.length - 1];
    if (!last) break;
    cursor = last.id;

    for (const p of persons) {
      const profile = parseProfile(p.knowledgeProfile);
      if (!profile) {
        stats.skipped += 1;
        continue;
      }
      if (args.skipExisting) {
        const existing = await prisma.personKnowledgeCategoryEmbedding.count({
          where: { personId: p.id },
        });
        if (existing > 0) {
          stats.skipped += 1;
          continue;
        }
      }
      if (args.dryRun) {
        console.log(
          `[backfill] dry-run: personId=${p.id} (${p.name}), categories=${profile.categories.length}`,
        );
        stats.processed += 1;
        stats.builtTotal += profile.categories.length;
        continue;
      }
      try {
        // Используем тот же метод, что вызывает Specialist32Service в rebuild.
        // Передаём profileBuildVersion как version, чтобы deleteMany ничего
        // не подтёр (мы хотим пересоздать всё ровно для текущей версии).
        const serialized: SerializedKnowledgeProfile = {
          ...profile,
          version: p.profileBuildVersion + 1, // увеличиваем, чтобы deleteMany снёс старые
        };
        const res = await specialist.rebuildCategoryEmbeddings({
          tenantId: p.tenantId,
          personId: p.id,
          profile: serialized,
        });
        stats.processed += 1;
        stats.builtTotal += res.built;
        console.log(
          `[backfill] personId=${p.id} (${p.name}): built ${res.built}/${profile.categories.length}`,
        );
      } catch (err) {
        stats.errors += 1;
        console.warn(
          `[backfill] personId=${p.id}: ошибка — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (persons.length < BATCH) break;
  }

  console.log('[backfill] done', stats);
  await app.close();
}

main().catch((err) => {
  console.error('[backfill] fatal', err);
  process.exit(1);
});
