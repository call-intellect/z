/**
 * audit Б8 (2026-05-29) — backfill ReferralAttribution.dateBucket
 * ПЕРЕД добавлением composite unique `@@unique([referralId, fingerprint,
 * dateBucket])`. Иначе `prisma db push` упадёт (колонка NOT NULL без default).
 *
 * Логика:
 *   1. dateBucket = to_char(createdAt AT TIME ZONE 'UTC', 'YYYY-MM-DD') —
 *      ровно так же как заполняет AttributionService.record() для новых
 *      записей. WHERE dateBucket IS NULL OR dateBucket = '' — идемпотентно.
 *   2. После backfill — dedupe записей, попавших в composite unique
 *      (referralId, fingerprint, dateBucket): оставляем самую старую,
 *      остальные DELETE. Без этого шага prisma db push упадёт на дублях.
 *
 * Идемпотентен (повторный запуск без эффекта).
 *
 * Порядок применения:
 *   1. (этот скрипт) — backfill + dedupe.
 *   2. `bun run prisma:push` — schema добавит NOT NULL + composite unique.
 *
 * Запуск:
 *   docker compose exec backend bun run scripts/patch-backfill-referral-attribution-date-bucket.ts
 *   docker compose exec backend bun run scripts/patch-backfill-referral-attribution-date-bucket.ts --dry-run
 *
 * Зарегистрирован в `apply-prod-deploy.ts` STEPS (phase: 'patch', skipBootstrap: true).
 */

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

interface CliOptions {
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  console.log('[audit Б8 backfill-referral-attribution-date-bucket] start', {
    dryRun: opts.dryRun,
  });

  // ───── Шаг 1: backfill dateBucket ─────
  // Поле в схеме ещё может быть String? (до prisma:push) ИЛИ String (после).
  // Тут заполняем тех, у кого NULL или пустая строка.
  const toFill = await prisma.$queryRaw<Array<{ cnt: bigint }>>`
    SELECT COUNT(*)::bigint AS cnt
    FROM "ReferralAttribution"
    WHERE "dateBucket" IS NULL OR "dateBucket" = ''
  `;
  const fillCount = Number(toFill[0]?.cnt ?? 0n);

  console.log(
    `[audit Б8] записей без dateBucket: ${fillCount}`,
  );

  if (fillCount > 0 && !opts.dryRun) {
    const updated: number = await prisma.$executeRaw`
      UPDATE "ReferralAttribution"
      SET "dateBucket" = to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD')
      WHERE "dateBucket" IS NULL OR "dateBucket" = ''
    `;

    console.log(`[audit Б8] backfilled dateBucket: ${updated} строк`);
  }

  // ───── Шаг 2: dedupe по (referralId, fingerprint, dateBucket) ─────
  // Только для fingerprint IS NOT NULL — composite unique игнорит NULL.
  const dupGroups = await prisma.$queryRaw<
    Array<{
      referral_id: string;
      fingerprint: string;
      date_bucket: string;
      cnt: bigint;
    }>
  >`
    SELECT
      "referralId" AS referral_id,
      "fingerprint",
      "dateBucket" AS date_bucket,
      COUNT(*)::bigint AS cnt
    FROM "ReferralAttribution"
    WHERE "fingerprint" IS NOT NULL
    GROUP BY "referralId", "fingerprint", "dateBucket"
    HAVING COUNT(*) > 1
  `;

  console.log(
    `[audit Б8] дубль-групп (referralId, fingerprint, dateBucket): ${dupGroups.length}`,
  );

  let totalDeleted = 0;
  for (const g of dupGroups) {
    const dupes = await prisma.referralAttribution.findMany({
      where: {
        referralId: g.referral_id,
        fingerprint: g.fingerprint,
        dateBucket: g.date_bucket,
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (dupes.length <= 1) continue;
    // Оставляем самую старую (первая в asc-сортировке).
    const toDelete = dupes.slice(1).map((d) => d.id);
    if (!opts.dryRun) {
      const res = await prisma.referralAttribution.deleteMany({
        where: { id: { in: toDelete } },
      });
      totalDeleted += res.count;
    } else {
      totalDeleted += toDelete.length;
    }
  }

  console.log(
    `[audit Б8] deleted dup-rows (оставлена самая старая в группе): ${totalDeleted}`,
  );

  console.log('[audit Б8 backfill-referral-attribution-date-bucket] done');
}

main()
  .catch((err) => {

    console.error('[audit Б8] FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
