/**
 * Patch (SBA α-6) — backfill CardVersion + Card.currentVersionId.
 *
 * После SBA α-6 каждая Card с непустым `summaryCache` должна иметь связанную
 * `CardVersion(version=1, payload=<snapshot>, changeReason='initial-backfill')`
 * и `Card.currentVersionId` указывающий на неё. Это нужно для:
 *   - истории изменений из admin UI (страница версий карточки);
 *   - корректной работы CurationService.triage() (auto-canonical создаёт
 *     `CardVersion(version=next)`, и без v1 нумерация будет 2/3/4 без 1);
 *   - chat-v2 citations (отображение источника текущего rollup'а).
 *
 * Запуск:
 *   bun run scripts/patch-backfill-card-versions.ts           — реальный backfill
 *   bun run scripts/patch-backfill-card-versions.ts --dry-run — только подсчёт
 *
 * Идемпотентно (фильтр `currentVersionId IS NULL AND summaryCache IS NOT NULL`).
 * Батч 500 карточек за раз. tenantId=NULL карточки (legacy без orga) пропускаем —
 * для них CardVersion нельзя создать (CardVersion.tenantId обязателен).
 */

import { type Prisma, PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 500;

interface Counters {
  scanned: number;
  backfilled: number;
  skippedNoTenant: number;
  skippedExistingVersion: number;
}

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  const counters: Counters = {
    scanned: 0,
    backfilled: 0,
    skippedNoTenant: 0,
    skippedExistingVersion: 0,
  };

  // eslint-disable-next-line no-console
  console.log(
    `=== patch-backfill-card-versions START (dryRun=${DRY_RUN}, batch=${BATCH_SIZE}) ===`,
  );

  // Курсор по id: в dry-run записи не получают currentVersionId и не
  // покидают фильтр, поэтому без курсора цикл крутился бы вечно на одном
  // и том же первом батче. Курсор продвигает выборку в обоих режимах.
  let cursor: string | null = null;

  try {
    while (true) {
      const batch = await prisma.card.findMany({
        where: {
          currentVersionId: null,
          summaryCache: { not: null },
          deletedAt: null,
        },
        select: {
          id: true,
          tenantId: true,
          kind: true,
          name: true,
          entityId: true,
          summaryCache: true,
          cachedTopThemeIds: true,
          sourceBlockIds: true,
        },
        take: BATCH_SIZE,
        orderBy: { id: 'asc' },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (batch.length === 0) break;
      counters.scanned += batch.length;
      cursor = batch[batch.length - 1]!.id;

      for (const card of batch) {
        if (!card.tenantId) {
          counters.skippedNoTenant++;
          continue;
        }

        // Защита от гонки: ещё раз проверим внутри транзакции, что версии нет.
        // unique-индекс (resourceType, resourceId, version) защищает от
        // двойной вставки v1, но проверка экономит retry-цикл.
        if (DRY_RUN) {
          counters.backfilled++;
          continue;
        }

        try {
          await prisma.$transaction(async (tx) => {
            const existing = await tx.cardVersion.findFirst({
              where: { resourceType: 'card', resourceId: card.id },
              orderBy: { version: 'desc' },
              select: { id: true, version: true },
            });

            if (existing) {
              // Версия уже есть — просто проставим currentVersionId.
              counters.skippedExistingVersion++;
              await tx.card.update({
                where: { id: card.id },
                data: { currentVersionId: existing.id },
              });
              return;
            }

            const payload: Prisma.InputJsonValue = {
              summaryCache: card.summaryCache,
              kind: card.kind,
              name: card.name,
              entityId: card.entityId,
              cachedTopThemeIds: card.cachedTopThemeIds,
              sourceBlockIds: card.sourceBlockIds,
            };

            const v1 = await tx.cardVersion.create({
              data: {
                tenantId: card.tenantId!, // checked above
                resourceType: 'card',
                resourceId: card.id,
                version: 1,
                previousVersionId: null,
                payload,
                changeReason: 'initial-backfill',
                createdByUserId: null,
                curationDecisionId: null,
                curationItemId: null,
              },
              select: { id: true },
            });

            await tx.card.update({
              where: { id: card.id },
              data: {
                currentVersionId: v1.id,
                // lastConfirmedAt — не трогаем: backfill ≠ свежее
                // подтверждение, оставим прежнее (либо null).
              },
            });

            counters.backfilled++;
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[warn] cardId=${card.id}: ${err instanceof Error ? err.message : String(err)} — пропускаю`,
          );
        }
      }

      // eslint-disable-next-line no-console
      console.log(
        `  батч обработан: всего отсканировано=${counters.scanned}, backfilled=${counters.backfilled}, skipped(no-tenant)=${counters.skippedNoTenant}, skipped(existing)=${counters.skippedExistingVersion}`,
      );

      if (batch.length < BATCH_SIZE) break;
    }
  } finally {
    await prisma.$disconnect();
  }

  // eslint-disable-next-line no-console
  console.log('=== patch-backfill-card-versions DONE ===');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(counters, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('patch-backfill-card-versions FAILED:', err);
  process.exit(1);
});
