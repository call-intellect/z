/**
 * audit Б7 (2026-05-29) — удалить дубли в ReferralPayout по triggerInvoiceId
 * ДО добавления @unique в schema.prisma. Иначе `prisma db push` упадёт.
 *
 * Логика:
 *   1. Группируем по triggerInvoiceId (NOT NULL).
 *   2. В каждой группе оставляем самую раннюю (по createdAt) запись;
 *      остальные DELETE (только pending, чтобы не отозвать выплаченное).
 *   3. Если в группе есть paid — оставляем paid (приоритет) и помечаем
 *      остальные как 'void' с reason.
 *
 * Идемпотентен.
 *
 * Запуск:
 *   docker compose exec backend bun run scripts/patch-dedupe-referral-payout.ts
 *   docker compose exec backend bun run scripts/patch-dedupe-referral-payout.ts --dry-run
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
  console.log('[audit Б7 dedupe-referral-payout] start', { dryRun: opts.dryRun });

  const groups = await prisma.$queryRaw<
    Array<{ trigger_invoice_id: string; cnt: bigint }>
  >`
    SELECT "triggerInvoiceId" AS trigger_invoice_id, COUNT(*)::bigint AS cnt
    FROM "ReferralPayout"
    WHERE "triggerInvoiceId" IS NOT NULL
    GROUP BY "triggerInvoiceId"
    HAVING COUNT(*) > 1
  `;
  console.log(
    `[audit Б7 dedupe-referral-payout] дубль-групп найдено: ${groups.length}`,
  );

  let totalDeleted = 0;
  let totalVoided = 0;
  for (const g of groups) {
    const dupes = await prisma.referralPayout.findMany({
      where: { triggerInvoiceId: g.trigger_invoice_id },
      orderBy: { createdAt: 'asc' },
    });
    if (dupes.length <= 1) continue;
    // Если есть paid — оставляем самый ранний paid; остальные void+reason.
    const paid = dupes.filter((d) => d.status === 'paid');
    let keepId: string;
    if (paid.length > 0) {
      keepId = paid[0]!.id;
    } else {
      keepId = dupes[0]!.id;
    }
    for (const d of dupes) {
      if (d.id === keepId) continue;
      if (d.status === 'paid') {
        // Не должно случиться (минимум одна paid → keepId), но защищаемся.
        console.warn(
          `[audit Б7 dedupe-referral-payout] два paid в группе ${g.trigger_invoice_id} — оставляем оба для ручного разбора`,
        );
        continue;
      }
      if (opts.dryRun) {
        console.log(
          `[audit Б7 dedupe-referral-payout] would ${d.status === 'pending' ? 'delete' : 'void'} payout ${d.id} (keep=${keepId})`,
        );
        if (d.status === 'pending') totalDeleted += 1;
        else totalVoided += 1;
        continue;
      }
      if (d.status === 'pending') {
        await prisma.referralPayout.delete({ where: { id: d.id } });
        totalDeleted += 1;
      } else {
        await prisma.referralPayout.update({
          where: { id: d.id },
          data: {
            status: 'void',
            voidReason: `audit Б7 dedupe: дубликат ${keepId}`,
          },
        });
        totalVoided += 1;
      }
    }
  }

  console.log(
    `[audit Б7 dedupe-referral-payout] done. deleted=${totalDeleted}, voided=${totalVoided}` +
      (opts.dryRun ? ' (dry-run)' : ''),
  );
}

main()
  .catch((err) => {
    console.error('[audit Б7 dedupe-referral-payout] ERROR', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
