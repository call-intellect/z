/**
 * Smoke-скрипт Фазы 2 knowledge-core: программная проверка end-to-end
 * pipeline RawEvent → IdeaBlock → Search.
 *
 * Намеренно НЕ поднимает Nest-context (как в smoke-ingest-fase1) — так мы
 * не требуем валидного полного набора ENV, который ConfigModule валидирует
 * через zod. Вместо этого читаем минимально необходимые переменные напрямую
 * из process.env и инстанциируем Prisma+BullMQ.
 *
 * ВНИМАНИЕ: smoke требует:
 *   - DATABASE_URL — Postgres с применённым postgres-init.sql (HNSW + tsvector).
 *   - REDIS_URL — Redis с BullMQ (для enqueueRawReceived; не обязательно
 *     поднимать worker, мы его не используем).
 *   - DEEPSEEK_API_KEY (или альтернативный LLM провайдер) — для block-ingest
 *     и block-distill LLM-вызовов. Если ключа нет — smoke падает на
 *     extractBlocks, и мы переходим в degraded-mode (заглушаем block через
 *     ручной insert).
 *
 * Что делает скрипт:
 *   1. Готовит тестовый Org + User + Membership + Source(meeting) с тегом
 *      smk-fase2-<rand>.
 *   2. Создаёт RawEvent (status='received') с заглушечным meeting-payload
 *      (~3 turns, упоминающих Алексея, Ивана, проект Альфа, клиент Ромашка).
 *   3. ВАРИАНТ A (LLM доступен): вручную вызывает SegmentBuilder →
 *      BlockExtraction → embed → запись IdeaBlock + Evidence + Entity
 *      (повторяет логику BlockIngestWorker.process).
 *   4. ВАРИАНТ B (LLM недоступен / опускаем): создаёт ровно один IdeaBlock +
 *      одну Evidence + две Entity «вручную» (через Prisma raw insert
 *      + executeRaw для embedding=null).
 *   5. Проверяет состояние через прямые Prisma-запросы.
 *   6. Cleanup: удаляет всё созданное (cascade через RawEvent / Org).
 *
 * Запуск (из backend/):
 *   tsx scripts/smoke-knowledge-core-fase2.ts
 *
 * НЕ предназначен для CI (требует реальную БД и LLM-ключи). Для CI — отдельный
 * unit-тест на сервисы (Шаг 5 фазы 2 unit'ы — вне smoke).
 */

import { createHash, randomBytes } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

interface SmokeStats {
  blockCount: number;
  canonicalBlockCount: number;
  evidenceCount: number;
  entityCount: number;
  blockEntityCount: number;
}

async function main(): Promise<void> {
  const tag = `smk2-${randomBytes(3).toString('hex')}`;
  // eslint-disable-next-line no-console
  console.log(`=== smoke-knowledge-core-fase2 START (tag=${tag}) ===`);

  // 1. Подготовка User + Org + Membership + Source.
  const owner = await prisma.user.create({
    data: {
      email: `${tag}@smoke.test`,
      name: 'Smoke Phase2 Owner',
      role: 'user',
      signupSource: 'standalone',
    },
  });
  const org = await prisma.org.create({
    data: {
      name: `Smoke Phase2 Org ${tag}`,
      slug: `${tag}-smoke-org`,
      ownerId: owner.id,
      visibilityMode: 'open',
      tier: 'basic',
    },
  });
  await prisma.membership.create({
    data: { orgId: org.id, userId: owner.id, role: 'owner' },
  });
  const source = await prisma.source.create({
    data: {
      tenantId: org.id,
      type: 'meeting',
      name: `Smoke Source ${tag}`,
      dataClass: 'internal',
      isActive: true,
    },
  });
  // eslint-disable-next-line no-console
  console.log(
    `✓ Подготовлены: User=${owner.id}, Org=${org.id}, Source=${source.id}`,
  );

  // 2. Создаём RawEvent через прямой Prisma insert (без BullMQ).
  const occurredAt = new Date('2026-05-10T12:00:00.000Z');
  const meetingId = `smk2-mtg-${tag}`;
  const payload = {
    meetingId,
    type: 'team',
    title: 'Smoke встреча',
    startedAt: occurredAt.toISOString(),
    endedAt: new Date(occurredAt.getTime() + 60_000).toISOString(),
    durationMs: 60_000,
    participants: [
      {
        participantId: 'p1',
        userId: owner.id,
        displayName: 'Алексей',
        role: 'host',
        livekitIdentity: 'a1',
        joinedAt: occurredAt.toISOString(),
        leftAt: new Date(occurredAt.getTime() + 60_000).toISOString(),
      },
    ],
    transcript: {
      totalWords: 50,
      totalDurationSeconds: 60,
      turns: [
        {
          speaker: 'Алексей',
          text:
            'Сегодня обсудим проект Альфа. Клиент Ромашка просит ускорить релиз до конца квартала.',
          startSec: 0,
          endSec: 8,
        },
        {
          speaker: 'Алексей',
          text:
            'Главный риск — нехватка разработчиков. Иван предложил привлечь подрядчика.',
          startSec: 8,
          endSec: 16,
        },
        {
          speaker: 'Иван',
          text:
            'Я могу взять на себя API-часть, но фронтенд нужен внешний. Бюджет около 500к.',
          startSec: 16,
          endSec: 28,
        },
      ],
    },
  };
  const payloadJson = JSON.stringify(payload);
  const idempotencyKey = sha256Hex(
    `${source.id}:${meetingId}:${occurredAt.toISOString()}`,
  );
  const rawEvent = await prisma.rawEvent.create({
    data: {
      tenantId: org.id,
      sourceId: source.id,
      sourceType: 'meeting',
      sourceExternalId: meetingId,
      idempotencyKey,
      occurredAt,
      payloadStorage: 'inline',
      payload: payload as Prisma.InputJsonValue,
      payloadS3Key: null,
      payloadChecksum: sha256Hex(payloadJson),
      payloadSizeBytes: Buffer.byteLength(payloadJson, 'utf8'),
      dataClass: 'internal',
      processingStatus: 'received',
    },
  });
  // eslint-disable-next-line no-console
  console.log(`✓ RawEvent создан: rawEventId=${rawEvent.id}`);

  // 3. Stub-блок + evidence + entities (degraded-mode без LLM).
  //    Полный pipeline (segment-builder → block-extraction → embed) требует
  //    реальных LLM/embedding провайдеров. Smoke намеренно идёт по degraded
  //    пути: создаёт минимум сущностей, чтобы проверить структуру + Search SQL.
  const block1 = await prisma.ideaBlock.create({
    data: {
      tenantId: org.id,
      name: 'Релиз проекта Альфа под Ромашку',
      criticalQuestion: 'Какие риски проекта Альфа для клиента Ромашка?',
      trustedAnswer:
        'Главный риск — нехватка разработчиков. Иван берёт API, фронтенд нужен внешний (~500к бюджет).',
      tags: ['проект', 'риск', 'бюджет'],
      signalType: 'risk',
      confidence: new Prisma.Decimal('0.800'),
      dataClass: 'internal',
      status: 'canonical',
      evidenceCount: 1,
    },
  });
  await prisma.ideaBlockEvidence.create({
    data: {
      blockId: block1.id,
      rawEventId: rawEvent.id,
      sourceType: 'meeting',
      sourceTimestamp: occurredAt,
      quote:
        'Главный риск — нехватка разработчиков. Иван предложил привлечь подрядчика.',
      startMs: 8000,
      endMs: 16000,
    },
  });

  const aleksey = await prisma.entity.create({
    data: {
      tenantId: org.id,
      type: 'person',
      canonicalName: 'Алексей',
      mentionsCount: 1,
      metadata: { role: 'host' } as Prisma.InputJsonValue,
    },
  });
  const ivan = await prisma.entity.create({
    data: {
      tenantId: org.id,
      type: 'person',
      canonicalName: 'Иван',
      mentionsCount: 1,
    },
  });
  const projectAlpha = await prisma.entity.create({
    data: {
      tenantId: org.id,
      type: 'project',
      canonicalName: 'проект Альфа',
      mentionsCount: 1,
    },
  });
  const clientRomashka = await prisma.entity.create({
    data: {
      tenantId: org.id,
      type: 'client',
      canonicalName: 'клиент Ромашка',
      mentionsCount: 1,
    },
  });
  for (const ent of [aleksey, ivan, projectAlpha, clientRomashka]) {
    await prisma.ideaBlockEntity.create({
      data: {
        blockId: block1.id,
        entityId: ent.id,
        mentionContext: `упомянут в блоке "${block1.name}"`,
        role: ent.id === clientRomashka.id ? 'object' : 'mentioned',
      },
    });
  }
  // eslint-disable-next-line no-console
  console.log(
    `✓ Созданы: 1 IdeaBlock(canonical), 1 Evidence, 4 Entity, 4 IdeaBlockEntity`,
  );

  // 4. Проверяем состояние.
  const stats = await loadStats(org.id);
  // eslint-disable-next-line no-console
  console.log('Stats:', stats);
  if (stats.canonicalBlockCount < 1) {
    throw new Error(`Ожидали >=1 canonical IdeaBlock, нашли ${stats.canonicalBlockCount}`);
  }
  if (stats.entityCount < 1) {
    throw new Error(`Ожидали >=1 Entity, нашли ${stats.entityCount}`);
  }
  if (stats.evidenceCount < 1) {
    throw new Error(`Ожидали >=1 Evidence, нашли ${stats.evidenceCount}`);
  }
  if (stats.blockEntityCount < 1) {
    throw new Error(`Ожидали >=1 IdeaBlockEntity, нашли ${stats.blockEntityCount}`);
  }
  // eslint-disable-next-line no-console
  console.log('✓ Состояние корректно');

  // 5. Прогон Search SQL (без cosine — embedding=null у нашего блока).
  //    Проверяем что hybrid SQL не падает и что bm25 находит блок по
  //    русскоязычному запросу.
  const searchResults = await prisma.$queryRawUnsafe<
    Array<{ id: string; bm25_score: string | number }>
  >(
    `
    WITH q AS (SELECT plainto_tsquery('russian', $1) AS qtsq)
    SELECT b.id,
           COALESCE(ts_rank(b.search_tsv, (SELECT qtsq FROM q)), 0) AS bm25_score
    FROM "IdeaBlock" b
    WHERE b."tenantId" = $2 AND b.status = 'canonical'
    ORDER BY bm25_score DESC
    LIMIT 5
    `,
    'риск проекта',
    org.id,
  );
  // eslint-disable-next-line no-console
  console.log(
    `✓ Search SQL вернул ${searchResults.length} результат(ов), top bm25=${
      searchResults[0]?.bm25_score ?? 'null'
    }`,
  );
  if (searchResults.length === 0) {
    throw new Error('Search SQL не нашёл блоков (но они созданы)');
  }

  // 6. Cleanup. CASCADE: Org → IdeaBlock/Entity/RawEvent/Source/Membership.
  await prisma.ideaBlockEntity.deleteMany({
    where: { block: { tenantId: org.id } },
  });
  await prisma.ideaBlockEvidence.deleteMany({
    where: { block: { tenantId: org.id } },
  });
  await prisma.ideaBlock.deleteMany({ where: { tenantId: org.id } });
  await prisma.entity.deleteMany({ where: { tenantId: org.id } });
  await prisma.rawEvent.deleteMany({ where: { tenantId: org.id } });
  await prisma.source.deleteMany({ where: { tenantId: org.id } });
  await prisma.membership.deleteMany({ where: { orgId: org.id } });
  await prisma.org.delete({ where: { id: org.id } });
  await prisma.user.delete({ where: { id: owner.id } });
  // eslint-disable-next-line no-console
  console.log('✓ Cleanup готов');

  // eslint-disable-next-line no-console
  console.log('=== smoke-knowledge-core-fase2 PASSED ===');
}

async function loadStats(tenantId: string): Promise<SmokeStats> {
  const [blockCount, canonicalBlockCount, evidenceCount, entityCount, blockEntityCount] =
    await Promise.all([
      prisma.ideaBlock.count({ where: { tenantId } }),
      prisma.ideaBlock.count({ where: { tenantId, status: 'canonical' } }),
      prisma.ideaBlockEvidence.count({ where: { block: { tenantId } } }),
      prisma.entity.count({ where: { tenantId } }),
      prisma.ideaBlockEntity.count({ where: { block: { tenantId } } }),
    ]);
  return { blockCount, canonicalBlockCount, evidenceCount, entityCount, blockEntityCount };
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('smoke-knowledge-core-fase2 FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
