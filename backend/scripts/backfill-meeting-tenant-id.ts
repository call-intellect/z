/**
 * Backfill для CRIT-3 (Sprint 1, тикет B2-1.3, 2026-05-24).
 *
 * Цель: безопасно заполнить `Meeting.tenantId` для legacy-записей, где
 * значение NULL. По текущей схеме (см. schema.prisma:892) tenantId уже
 * объявлен NOT NULL — поэтому на «здоровой» БД скрипт ничего не найдёт
 * и завершится с нулевыми счётчиками.
 *
 * Скрипт остаётся в репозитории как safety net для:
 *   - окружений, где админ откатывал NOT NULL вручную;
 *   - восстановлений из старых бэкапов с legacy-данными;
 *   - сторонних дев-баз с историческими данными до backfill-orgs-fase0.
 *
 * Почему raw SQL, а не Prisma client:
 *   В типах Prisma `tenantId: string` (NOT NULL), поэтому
 *   `where: { tenantId: null }` отвергнется на этапе compile. Чтобы
 *   скрипт всё равно мог обнаружить legacy-NULL в БД, обращаемся к
 *   таблице напрямую через $queryRawUnsafe.
 *
 * Источники tenantId (приоритет сверху вниз):
 *   1. owner.tenantId (если у владельца встречи проставлен личный Org).
 *   2. Первый Org, которым владеет owner (Org.ownerId = Meeting.ownerId).
 *   3. Если ничего — skip с пометкой в финальном отчёте.
 *
 * Идемпотентность: обновляются только записи с tenantId IS NULL; уже
 * заполненные не трогаются. Повторный запуск безопасен.
 *
 * Запуск:
 *   bun run scripts/backfill-meeting-tenant-id.ts                  # dry-run (default)
 *   bun run scripts/backfill-meeting-tenant-id.ts --apply          # реально применить
 *   bun run scripts/backfill-meeting-tenant-id.ts --batch-size=50  # размер батча
 *
 * См. правила safe-seed-rules: dry-run по умолчанию, явное --apply,
 * pino-логирование (через console для one-off), идемпотентность.
 */

import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const log = new Logger('backfill-meeting-tenant-id');

interface CliFlags {
  apply: boolean;
  batchSize: number;
}

function parseFlags(argv: string[]): CliFlags {
  let apply = false;
  let batchSize = 100;
  for (const arg of argv.slice(2)) {
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--dry-run') {
      apply = false;
      continue;
    }
    const m = /^--batch-size=(\d+)$/.exec(arg);
    if (m) {
      batchSize = Math.max(1, Math.min(1000, Number(m[1])));
      continue;
    }
    log.warn(`Неизвестный флаг: ${arg} — игнорирую`);
  }
  return { apply, batchSize };
}

interface LegacyMeetingRow {
  id: string;
  ownerId: string;
}

async function fetchLegacyMeetings(limit: number): Promise<LegacyMeetingRow[]> {
  // raw SQL — Prisma client считает tenantId NOT NULL и не даст
  // составить where: { tenantId: null }. Здесь мы обходим типы намеренно.
  // Используем $queryRawUnsafe + параметр через шаблонную строку безопасно,
  // т.к. limit — number, валидированный parseFlags.
  return prisma.$queryRawUnsafe<LegacyMeetingRow[]>(
    `SELECT "id", "ownerId" FROM "Meeting" WHERE "tenantId" IS NULL ORDER BY "createdAt" ASC LIMIT ${limit}`,
  );
}

async function countLegacyMeetings(): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "Meeting" WHERE "tenantId" IS NULL`,
  );
  const first = rows[0];
  return first ? Number(first.count) : 0;
}

async function resolveTenantId(ownerId: string): Promise<string | null> {
  // 1) Личный tenantId владельца (User.tenantId, если поле есть в схеме).
  // Здесь делаем raw-select, чтобы не зависеть от точного имени поля в Prisma client.
  const userRows = await prisma.$queryRawUnsafe<Array<{ tenantId: string | null }>>(
    `SELECT "tenantId" FROM "User" WHERE "id" = $1 LIMIT 1`,
    ownerId,
  ).catch(() => [] as Array<{ tenantId: string | null }>);
  const userTenant = userRows[0]?.tenantId ?? null;
  if (userTenant) return userTenant;

  // 2) Первый Org, которым владеет user (личная орг по бэкфиллу из fase0).
  const org = await prisma.org.findFirst({
    where: { ownerId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return org?.id ?? null;
}

async function applyBackfillOne(meetingId: string, tenantId: string): Promise<void> {
  // raw UPDATE — по той же причине, что и SELECT выше. Также гарантируем,
  // что НЕ перезатираем уже-проставленный tenantId (идемпотентность).
  await prisma.$executeRawUnsafe(
    `UPDATE "Meeting" SET "tenantId" = $1 WHERE "id" = $2 AND "tenantId" IS NULL`,
    tenantId,
    meetingId,
  );
}

interface RunReport {
  totalNullBefore: number;
  totalUpdated: number;
  totalSkipped: number;
  skippedReasons: Record<string, number>;
  planned: Array<{ meetingId: string; ownerId: string; tenantId: string | null }>;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  log.log(`=== backfill-meeting-tenant-id START (mode=${flags.apply ? 'APPLY' : 'DRY-RUN'}, batchSize=${flags.batchSize}) ===`);

  const totalNullBefore = await countLegacyMeetings();
  log.log(`Найдено Meeting с tenantId IS NULL: ${totalNullBefore}`);
  if (totalNullBefore === 0) {
    log.log('Ничего бэкфиллить не требуется. Возможно, схема уже NOT NULL и данные чистые.');
    log.log('=== backfill-meeting-tenant-id DONE ===');
    return;
  }

  const report: RunReport = {
    totalNullBefore,
    totalUpdated: 0,
    totalSkipped: 0,
    skippedReasons: {},
    planned: [],
  };

  let processed = 0;
  // Простой пагинационный цикл: после каждого батча в APPLY-режиме
  // фактическое число null падает, поэтому всегда берём «первые N» с условием.
  while (processed < totalNullBefore) {
    const batch = await fetchLegacyMeetings(flags.batchSize);
    if (batch.length === 0) break;

    for (const m of batch) {
      const tenantId = await resolveTenantId(m.ownerId);
      if (!tenantId) {
        report.totalSkipped += 1;
        const reason = 'no_tenant_resolvable_for_owner';
        report.skippedReasons[reason] = (report.skippedReasons[reason] ?? 0) + 1;
        log.warn(`SKIP meeting=${m.id} owner=${m.ownerId} — tenantId не определён ни через User.tenantId, ни через Org.ownerId`);
        continue;
      }

      report.planned.push({ meetingId: m.id, ownerId: m.ownerId, tenantId });

      if (flags.apply) {
        await applyBackfillOne(m.id, tenantId);
        report.totalUpdated += 1;
      }
    }

    processed += batch.length;
    log.log({ processed, total: totalNullBefore, batchSize: batch.length }, 'batch processed');

    if (!flags.apply) {
      // В dry-run выходим после первого батча, чтобы не зацикливаться
      // (мы ничего не изменили — следующий fetchLegacyMeetings вернёт те же id).
      log.log('DRY-RUN: показан один батч, остальное аналогично. Запусти с --apply для применения.');
      break;
    }
  }

  // Финальный отчёт
  log.log('=== ИТОГ ===');
  log.log(`totalNullBefore: ${report.totalNullBefore}`);
  log.log(`totalUpdated:    ${report.totalUpdated}`);
  log.log(`totalSkipped:    ${report.totalSkipped}`);
  log.log(`skippedReasons:  ${JSON.stringify(report.skippedReasons)}`);
  if (!flags.apply) {
    const previewLimit = 20;
    log.log(`Пример plan (первые ${previewLimit}):`);
    for (const p of report.planned.slice(0, previewLimit)) {
      log.log(`  meeting=${p.meetingId} owner=${p.ownerId} → tenantId=${p.tenantId}`);
    }
    if (report.planned.length > previewLimit) {
      log.log(`  ... и ещё ${report.planned.length - previewLimit}`);
    }
  }

  log.log('=== backfill-meeting-tenant-id DONE ===');
}

// TODO Sprint 2+: после успешного backfill на prod:
// 1. Проверить, что 0 записей с tenantId IS NULL:
//      SELECT COUNT(*) FROM "Meeting" WHERE "tenantId" IS NULL;
// 2. В schema.prisma — убедиться, что tenantId уже String (NOT NULL).
//    На момент 2026-05-24 это уже сделано (schema.prisma:892).
// 3. bun run prisma:push (если меняли).
// 4. Найти и удалить весь if (!meeting.tenantId) код по проекту:
//      grep -rn "meeting.tenantId" backend/src/
//    — оставлять защиту имеет смысл только если есть риск отката NOT NULL.

main()
  .catch((err) => {
    log.error('backfill-meeting-tenant-id FAILED');
    log.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
