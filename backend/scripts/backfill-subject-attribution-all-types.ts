/**
 * Ф1 (knowledge-access, 2026-06-06) — Backfill `role='subject'` для исторических
 * canonical-блоков ВСЕХ типов знания (не только reasoning-семейство) +
 * per-adapter identity автора + ре-rebuild ролевых клонов.
 *
 * Контекст:
 *   ТЗ `plans/tz/2026-06-06-knowledge-access-groups-and-provenance.md` Фаза 1.
 *   До Ф1 детерминированная привязка автора (`IdeaBlockEntity.role='subject'`)
 *   писалась ТОЛЬКО для 6 reasoning-типов. Обычные факты оставались без автора →
 *   who-ось пуста, клоны собираются узко. Ф1 расширила привязку на ВСЕ signalType
 *   (флаг `knowledge.subjectAttributionAllTypes`, code-fallback true) для НОВЫХ
 *   блоков. Этот backfill добивает `role='subject'` для уже сохранённых
 *   canonical-блоков любого типа, у которых ещё нет subject-связи.
 *
 *   Образец — `backfill-subject-attribution.ts` (reasoning-only). Отличия:
 *     - Сканирует canonical-блоки ЛЮБОГО signalType, но только без subject-связи
 *       (idempotent + incremental: `entities: { none: { role: 'subject' } }`).
 *     - Уважает ДВА флага: `knowledge.subjectAttributionEnabled` (как образец) И
 *       `knowledge.subjectAttributionAllTypes` (если false → выход, расширенная
 *       привязка выключена).
 *     - Identity автора — per-adapter (`tryGetActorIdentity`, зеркало воркера):
 *       tracker actor.userId / chatbox responsible.personId / dump uploaderId /
 *       free_note userId / email from.address. Для встреч (identity пуст) —
 *       сегмент по таймкоду evidence.startMs (speakerParticipantId/speakerName).
 *
 *   Сервисы переиспользуются через Nest DI (НЕ дублируем resolve-логику):
 *   SegmentBuilderService, EntityResolutionService, S3Service,
 *   Specialist37Service, CoreQueueService.
 *
 * Идемпотентность:
 *   - Кандидаты — только блоки без `IdeaBlockEntity{role='subject'}` →
 *     повторный прогон = 0 кандидатов = no-op.
 *   - upsert по композитному PK `@@id([blockId, entityId])` (страховка от гонки).
 *   - ре-enqueue дедуплицирован по personId (Set).
 *
 * Запуск:
 *   docker compose exec backend bun run scripts/backfill-subject-attribution-all-types.ts --dry-run
 *   docker compose exec backend bun run scripts/backfill-subject-attribution-all-types.ts
 *   docker compose exec backend bun run scripts/backfill-subject-attribution-all-types.ts --tenant=<orgId>
 *   docker compose exec backend bun run scripts/backfill-subject-attribution-all-types.ts --limit=5000
 *
 * Регистрация: backend/scripts/apply-prod-deploy.ts (phase: 'backfill', skipBootstrap).
 */

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { TypedConfigService } from '../src/common/config/index';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { CoreQueueService } from '../src/modules/core-queue/core-queue.service';
import { EntityResolutionService } from '../src/modules/knowledge-core/services/entity-resolution.service';
import { SegmentBuilderService } from '../src/modules/knowledge-core/services/segment-builder.service';
import { Specialist37Service } from '../src/modules/knowledge-core/services/specialist-3-7-skill.service';
import { S3Service } from '../src/modules/recordings/s3.service';

import { createPrismaClient } from './_lib/prisma';
import { silenceRedisShutdownNoise } from './_lib/silence-redis-shutdown';

const BATCH_SIZE = 200;

interface Options {
  tenantId?: string;
  limit?: number;
  dryRun: boolean;
}

interface Stats {
  scanned: number;
  attributed: number;
  skipped: number;
  /** Кандидаты на rebuild (уникальные personId). */
  personsEnqueued: number;
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
 * Ф1 — зеркало `BlockIngestWorker.tryGetActorIdentity`. Извлекает per-adapter
 * identity автора события из payload (tracker/chatbox/dump/free_note/email).
 */
function tryGetActorIdentity(payload: unknown): {
  authorUserId: string | null;
  authorPersonId: string | null;
  authorEmail: string | null;
} {
  const empty = {
    authorUserId: null,
    authorPersonId: null,
    authorEmail: null,
  };
  if (typeof payload !== 'object' || payload === null) return empty;
  const p = payload as Record<string, unknown>;

  // tracker — actor.userId
  const actor = p['actor'];
  if (actor && typeof actor === 'object') {
    const uid = (actor as { userId?: unknown }).userId;
    if (typeof uid === 'string' && uid.trim().length > 0) {
      return { ...empty, authorUserId: uid };
    }
  }
  // chatbox — responsible.personId (linkedPersonId)
  const resp = p['responsible'];
  if (resp && typeof resp === 'object') {
    const pid = (resp as { personId?: unknown }).personId;
    if (typeof pid === 'string' && pid.trim().length > 0) {
      return { ...empty, authorPersonId: pid };
    }
  }
  // dump/text — uploaderId (Person.id)
  const uploaderId = p['uploaderId'];
  if (typeof uploaderId === 'string' && uploaderId.trim().length > 0) {
    return { ...empty, authorPersonId: uploaderId };
  }
  // free_note/in_app — userId
  const userIdRaw = p['userId'];
  if (typeof userIdRaw === 'string' && userIdRaw.trim().length > 0) {
    return { ...empty, authorUserId: userIdRaw };
  }
  // email — from.address
  const from = p['from'];
  if (from && typeof from === 'object') {
    const addr = (from as { address?: unknown }).address;
    if (typeof addr === 'string' && addr.includes('@')) {
      return { ...empty, authorEmail: addr };
    }
  }
  return empty;
}

async function main(opts: Options): Promise<void> {
  console.log(
    `=== backfill-subject-attribution-all-types START ` +
      `(dryRun=${opts.dryRun}, tenant=${opts.tenantId ?? '<all>'}, ` +
      `limit=${opts.limit ?? '<none>'}) ===`,
  );

  // Кандидаты — canonical-блоки ЛЮБОГО типа БЕЗ subject-связи (идемпотентность +
  // инкрементальность: повторный прогон = 0 кандидатов).
  const blockWhere = {
    status: 'canonical' as const,
    entities: { none: { role: 'subject' as const } },
    ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
  };

  // Лёгкий pre-check ДО подъёма AppModule.
  const preCheck = createPrismaClient();
  try {
    const pending = await preCheck.ideaBlock.count({ where: blockWhere });
    if (pending === 0) {
      console.log(
        'backfill-subject-attribution-all-types: нет canonical-блоков без subject-связи — backfill не требуется.',
      );
      return;
    }
    console.log(
      `backfill-subject-attribution-all-types: кандидатов-блоков ${pending}`,
    );
  } finally {
    await preCheck.$disconnect();
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const stats: Stats = {
    scanned: 0,
    attributed: 0,
    skipped: 0,
    personsEnqueued: 0,
  };

  try {
    const prisma = app.get(PrismaService);
    const cfg = app.get(TypedConfigService);
    const segments = app.get(SegmentBuilderService);
    const entities = app.get(EntityResolutionService);
    const s3 = app.get(S3Service);
    const specialist = app.get(Specialist37Service);
    const coreQueue = app.get(CoreQueueService);

    // Уважаем ДВА флага: master-выключатель + расширенная привязка на все типы.
    const enabled = await cfg.getDynamic<boolean>(
      'knowledge.subjectAttributionEnabled',
      undefined,
      true,
    );
    if (!enabled) {
      console.log(
        'backfill-subject-attribution-all-types: knowledge.subjectAttributionEnabled=false — пропуск (kill-switch).',
      );
      return;
    }
    const allTypes = await cfg.getDynamic<boolean>(
      'knowledge.subjectAttributionAllTypes',
      undefined,
      true,
    );
    if (!allTypes) {
      console.log(
        'backfill-subject-attribution-all-types: knowledge.subjectAttributionAllTypes=false — пропуск (расширенная привязка выключена).',
      );
      return;
    }

    // Уникальные затронутые (tenantId, entityId) → Person'ы → ре-rebuild.
    const affected = new Map<string, { tenantId: string; entityId: string }>();

    // Кэш payload по rawEventId.
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
          throw new Error(
            `RawEvent ${event.id}: payloadStorage=s3, но payloadS3Key пустой`,
          );
        }
        result = await s3.getJson<unknown>(event.payloadS3Key);
      } else {
        result = event.payload;
      }
      payloadCache.set(event.id, result);
      return result;
    };

    // Курсорная пагинация. ВАЖНО: курсор по id; т.к. мы фильтруем по «без
    // subject-связи», уже обработанные в этом же прогоне блоки получают связь и
    // выпадают из выборки — поэтому курсор обязателен (иначе бесконечный цикл
    // на блоках-«пропусках», у которых identity не разрешилась).
    let cursorId: string | undefined = undefined;
    let processed = 0;
    while (true) {
      if (opts.limit && processed >= opts.limit) break;
      const take = opts.limit
        ? Math.min(BATCH_SIZE, opts.limit - processed)
        : BATCH_SIZE;

      const batch = await prisma.ideaBlock.findMany({
        where: blockWhere,
        select: { id: true, tenantId: true, signalType: true },
        orderBy: { id: 'asc' },
        take,
        ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
      });
      if (batch.length === 0) break;

      for (const block of batch) {
        stats.scanned++;
        processed++;
        try {
          // 1. Источник: первое evidence блока (rawEventId + startMs).
          const evidence = await prisma.ideaBlockEvidence.findFirst({
            where: { blockId: block.id },
            orderBy: { createdAt: 'asc' },
            select: { rawEventId: true, startMs: true },
          });
          if (!evidence) {
            stats.skipped++;
            continue;
          }

          const event = await prisma.rawEvent.findUnique({
            where: { id: evidence.rawEventId },
            select: {
              id: true,
              tenantId: true,
              payloadStorage: true,
              payload: true,
              payloadS3Key: true,
            },
          });
          if (!event) {
            stats.skipped++;
            continue;
          }

          const payload = await loadPayload(event);

          // 2. Identity автора — зеркало tryGetActorIdentity воркера. Для встреч
          //    (identity пуст) — сегмент по таймкоду evidence.startMs.
          const identity = tryGetActorIdentity(payload);

          let speakerParticipantId: string | null = null;
          let speakerName: string | null = null;
          const hasDirectIdentity =
            !!identity.authorUserId ||
            !!identity.authorPersonId ||
            !!identity.authorEmail;
          if (!hasDirectIdentity) {
            const segs = segments.buildSegments(payload);
            const evidenceStartMs = evidence.startMs ?? 0;
            const seg =
              segs.find(
                (s) =>
                  s.endMs > 0 &&
                  evidenceStartMs >= s.startMs &&
                  evidenceStartMs <= s.endMs,
              ) ?? null;
            speakerParticipantId = seg?.speakerParticipantId ?? null;
            speakerName = seg?.speakers?.[0] ?? null;
          }

          const subjectEntityId = await entities.resolveSubjectEntityId(
            event.tenantId,
            {
              authorPersonId: identity.authorPersonId,
              authorEmail: identity.authorEmail,
              authorUserId: identity.authorUserId,
              speakerParticipantId,
              speakerName,
            },
          );
          if (!subjectEntityId) {
            stats.skipped++;
            continue;
          }

          if (opts.dryRun) {
            console.log(
              `[DRY-RUN] would upsert IdeaBlockEntity{blockId=${block.id}, entityId=${subjectEntityId}, role=subject}`,
            );
          } else {
            // 3. Idempotent upsert — апгрейд mentioned→subject односторонний.
            await prisma.ideaBlockEntity.upsert({
              where: {
                blockId_entityId: {
                  blockId: block.id,
                  entityId: subjectEntityId,
                },
              },
              create: {
                blockId: block.id,
                entityId: subjectEntityId,
                mentionContext: 'author',
                role: 'subject',
              },
              update: { role: 'subject' },
            });
          }
          stats.attributed++;
          affected.set(`${event.tenantId}:${subjectEntityId}`, {
            tenantId: event.tenantId,
            entityId: subjectEntityId,
          });
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

    // 4. Ре-rebuild ролевых клонов по затронутым авторам (employee-Person).
    const enqueuedPersonIds = new Set<string>();
    for (const { tenantId, entityId } of affected.values()) {
      try {
        const persons = await prisma.person.findMany({
          where: {
            tenantId,
            entityId,
            relationship: 'employee',
            deletedAt: null,
          },
          select: { id: true },
        });
        for (const p of persons) {
          if (enqueuedPersonIds.has(p.id)) continue;
          enqueuedPersonIds.add(p.id);
          stats.personsEnqueued++;
          if (opts.dryRun) {
            console.log(
              `[DRY-RUN] would enqueue skill-profile-rebuild personId=${p.id} tenantId=${tenantId}`,
            );
            continue;
          }
          const profile = await specialist.getOrCreateForPerson({
            tenantId,
            personId: p.id,
          });
          if (!profile) continue;
          await coreQueue.enqueueRebuildSkillProfile({
            tenantId,
            profileId: profile.id,
            reason: 'backfill-subject-attribution-all-types',
            delayMs: 0,
          });
        }
      } catch (err) {
        console.warn(
          `[error] re-enqueue tenantId=${tenantId} entityId=${entityId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    console.log('=== Итоги backfill-subject-attribution-all-types ===');
    console.log(`  scanned         : ${stats.scanned}`);
    console.log(`  attributed      : ${stats.attributed}`);
    console.log(`  skipped         : ${stats.skipped}`);
    console.log(`  personsEnqueued : ${stats.personsEnqueued}`);
    console.log(`  mode            : ${opts.dryRun ? 'DRY-RUN' : 'APPLY'}`);
  } finally {
    await app.close();
  }
}

const opts = parseArgs(process.argv.slice(2));
silenceRedisShutdownNoise();
main(opts)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('backfill-subject-attribution-all-types FAILED:', err);
    process.exit(1);
  });
