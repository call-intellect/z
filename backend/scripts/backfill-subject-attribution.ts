/**
 * Фаза 1.3 (2026-06-04) — Backfill `mentioned→subject` для исторических
 * блоков-рассуждений + ре-rebuild ролевых клонов.
 *
 * Контекст:
 *   ТЗ `plans/tz/2026-06-04-meeting-identity-and-clones-attribution.md` §1.3.
 *   Фаза 1.2 включила детерминированную запись `IdeaBlockEntity.role='subject'`
 *   для НОВЫХ блоков (block-ingest.worker → attributeSubject). Но исторические
 *   canonical-блоки, извлечённые ДО фикса, остались без автора (role='subject'
 *   не писалась ни одной строкой кода). Без этого ролевые клоны (Specialist 3-7
 *   / ExecutablePersona), router.hasEmployeeSubject, WHO-ось и дашборд-агенты
 *   читают пустую выборку — «главная ценность продукта пустая».
 *
 *   Этот backfill повторяет логику воркера (`attributeSubject` +
 *   `EntityResolutionService.resolveSubjectEntityId`), но для уже сохранённых
 *   canonical-блоков семейства reasoning: находит source-RawEvent через
 *   IdeaBlockEvidence, определяет автора (meeting — по сегменту/спикеру;
 *   text — по `payload.userId`), upsert'ит связь `role='subject'` и затем
 *   ре-enqueue `core.skill-profile-rebuild` для затронутых employee-Person'ов.
 *
 *   Сервисы переиспользуются через Nest DI (НЕ дублируем resolve-логику):
 *   SegmentBuilderService, EntityResolutionService, S3Service,
 *   Specialist37Service, CoreQueueService.
 *
 * Идемпотентность (acceptance-критерий §1.3):
 *   - upsert по композитному PK `@@id([blockId, entityId])`:
 *       create → role='subject'; update → role='subject' (апгрейд mentioned→subject
 *       односторонний). Повторный прогон = no-op (count role='subject' стабилен).
 *   - ре-enqueue дедуплицирован по personId (Set) + jobId
 *       `skill-profile-rebuild_<profileId>` + debounce на стороне очереди.
 *
 * Kill-switch:
 *   AdminSetting `knowledge.subjectAttributionEnabled` (code-fallback `true`).
 *   При `false` атрибуция новых блоков выключена; backfill уважает тот же флаг —
 *   при `false` выходит без записи (как и воркер пропускает шаг).
 *
 * Запуск:
 *   docker compose exec backend bun run scripts/backfill-subject-attribution.ts --dry-run  # только counts
 *   docker compose exec backend bun run scripts/backfill-subject-attribution.ts             # запись
 *   docker compose exec backend bun run scripts/backfill-subject-attribution.ts --tenant=<orgId>
 *   docker compose exec backend bun run scripts/backfill-subject-attribution.ts --limit=5000
 *
 * Регистрация: backend/scripts/apply-prod-deploy.ts (phase: 'backfill', skipBootstrap).
 */

import { NestFactory } from '@nestjs/core';
import type { SignalType } from '@prisma/client';

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

/**
 * SignalType'ы семейства «рассуждение» — те же, что REASONING_SUBJECT_SIGNAL_TYPES
 * в block-ingest.worker.ts. Только для них пишется role='subject'.
 */
const REASONING_SUBJECT_SIGNAL_TYPES = [
  'reasoning',
  'rationale',
  'decision_basis',
  'expertise',
  'experience',
  'competence',
] as const;

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

/** Извлечь userId автора текстового канала (free_note / in_app). Зеркало
 * `BlockIngestWorker.tryGetAuthorUserId`. */
function tryGetAuthorUserId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const v = (payload as { userId?: unknown }).userId;
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}

async function main(opts: Options): Promise<void> {
  console.log(
    `=== backfill-subject-attribution START ` +
      `(dryRun=${opts.dryRun}, tenant=${opts.tenantId ?? '<all>'}, ` +
      `limit=${opts.limit ?? '<none>'}) ===`,
  );

  // Лёгкий pre-check ДО подъёма AppModule (Nest DI + Redis/BullMQ): если нет
  // canonical-блоков семейства reasoning — выходим чисто, не поднимая тяжёлый
  // контекст и не требуя готовой очереди.
  const blockWhere = {
    status: 'canonical' as const,
    signalType: {
      in: REASONING_SUBJECT_SIGNAL_TYPES as unknown as SignalType[],
    },
    ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
  };
  const preCheck = createPrismaClient();
  try {
    const pending = await preCheck.ideaBlock.count({ where: blockWhere });
    if (pending === 0) {
      console.log(
        'backfill-subject-attribution: нет canonical-блоков семейства reasoning — backfill не требуется.',
      );
      return;
    }
    console.log(`backfill-subject-attribution: кандидатов-блоков ${pending}`);
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

    // Kill-switch — тот же AdminSetting, что и воркер. При false — выходим
    // без записи (как воркер пропускает attributeSubject).
    const enabled = await cfg.getDynamic<boolean>(
      'knowledge.subjectAttributionEnabled',
      undefined,
      true,
    );
    if (!enabled) {
      console.log(
        'backfill-subject-attribution: knowledge.subjectAttributionEnabled=false — пропуск (kill-switch).',
      );
      return;
    }

    // Уникальные затронутые (tenantId, entityId) → разрешим в Person'ов и
    // соберём по ним ре-rebuild. Дедуп ниже по personId.
    const affected = new Map<string, { tenantId: string; entityId: string }>();

    // Кэш payload по rawEventId: один RawEvent рождает много блоков, не грузим
    // payload (особенно S3) повторно.
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

    // Курсорная пагинация по canonical-блокам семейства reasoning.
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

          // 2. Определить identity автора — зеркало attributeSubject:
          //    text → payload.userId; meeting → сегмент по таймкоду evidence.
          const authorUserId = tryGetAuthorUserId(payload);

          let speakerParticipantId: string | null = null;
          let speakerName: string | null = null;
          if (!authorUserId) {
            // Встреча: строим сегменты и ищем покрывающий evidence.startMs.
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
            { speakerParticipantId, speakerName, authorUserId },
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

    // 4. Ре-rebuild ролевых клонов по затронутым авторам. Резолвим
    //    (tenantId, entityId) → employee-Person → SkillProfile → enqueue.
    //    Дедуп по personId (Set): один и тот же автор у многих блоков.
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
          // getOrCreateForPerson вернёт профиль только для employee'ев
          // (проверка внутри); enqueue по profileId с дедупом jobId+debounce.
          const profile = await specialist.getOrCreateForPerson({
            tenantId,
            personId: p.id,
          });
          if (!profile) continue;
          await coreQueue.enqueueRebuildSkillProfile({
            tenantId,
            profileId: profile.id,
            reason: 'backfill-subject-attribution',
            delayMs: 0,
          });
        }
      } catch (err) {
        console.warn(
          `[error] re-enqueue tenantId=${tenantId} entityId=${entityId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    console.log('=== Итоги backfill-subject-attribution ===');
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
    console.error('backfill-subject-attribution FAILED:', err);
    process.exit(1);
  });
