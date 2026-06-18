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

  const groups = await prisma.$queryRaw<Array<{ trigger_invoice_id: string; cnt: bigint }>>`
    SELECT "triggerInvoiceId" AS trigger_invoice_id, COUNT(*)::bigint AS cnt
    FROM "ReferralPayout"
    WHERE "triggerInvoiceId" IS NOT NULL
    GROUP BY "triggerInvoiceId"
    HAVING COUNT(*) > 1
  `;
  console.log(`[audit Б7 dedupe-referral-payout] дубль-групп найдено: ${groups.length}`);

  let totalDeleted = 0;
  let totalVoided = 0;
  for (const g of groups) {
    const dupes = await prisma.referralPayout.findMany({
      where: { triggerInvoiceId: g.trigger_invoice_id },
      orderBy: { createdAt: 'asc' },
    });
    if (dupes.length <= 1) continue;
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
