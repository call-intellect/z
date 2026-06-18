import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();
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
  const userRows = await prisma
    .$queryRawUnsafe<
      Array<{ tenantId: string | null }>
    >(`SELECT "tenantId" FROM "User" WHERE "id" = $1 LIMIT 1`, ownerId)
    .catch(() => [] as Array<{ tenantId: string | null }>);
  const userTenant = userRows[0]?.tenantId ?? null;
  if (userTenant) return userTenant;

  const org = await prisma.org.findFirst({
    where: { ownerId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return org?.id ?? null;
}

async function applyBackfillOne(meetingId: string, tenantId: string): Promise<void> {
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
  log.log(
    `=== backfill-meeting-tenant-id START (mode=${flags.apply ? 'APPLY' : 'DRY-RUN'}, batchSize=${flags.batchSize}) ===`,
  );

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
  while (processed < totalNullBefore) {
    const batch = await fetchLegacyMeetings(flags.batchSize);
    if (batch.length === 0) break;

    for (const m of batch) {
      const tenantId = await resolveTenantId(m.ownerId);
      if (!tenantId) {
        report.totalSkipped += 1;
        const reason = 'no_tenant_resolvable_for_owner';
        report.skippedReasons[reason] = (report.skippedReasons[reason] ?? 0) + 1;
        log.warn(
          `SKIP meeting=${m.id} owner=${m.ownerId} — tenantId не определён ни через User.tenantId, ни через Org.ownerId`,
        );
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
      log.log(
        'DRY-RUN: показан один батч, остальное аналогично. Запусти с --apply для применения.',
      );
      break;
    }
  }

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

main()
  .catch((err) => {
    log.error('backfill-meeting-tenant-id FAILED');
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
