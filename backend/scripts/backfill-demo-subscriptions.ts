import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

interface Result {
  total: number;
  created: number;
  skipped: number;
  errors: number;
}

async function main(): Promise<Result> {
  const orgs = await prisma.org.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const result: Result = {
    total: orgs.length,
    created: 0,
    skipped: 0,
    errors: 0,
  };

  console.log(`[backfill-demo-subscriptions] Найдено ${orgs.length} активных Org`);

  for (const org of orgs) {
    try {
      const existing = await prisma.subscription.findUnique({
        where: { tenantId: org.id },
      });
      if (existing) {
        result.skipped += 1;
        continue;
      }

      const created = await prisma.subscription.create({
        data: { tenantId: org.id },
      });
      await prisma.subscriptionEvent.create({
        data: {
          subscriptionId: created.id,
          eventType: 'created',
          payload: { initial: true, backfill: 'backfill-demo-subscriptions' },
        },
      });
      result.created += 1;
      console.log(`  ✓ ${org.name} (${org.id}) — создана DEMO-подписка ${created.id}`);
    } catch (err) {
      result.errors += 1;
      console.error(
        `  ✗ ${org.name} (${org.id}) — ошибка: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log(
    `[backfill-demo-subscriptions] Готово: created=${result.created} skipped=${result.skipped} errors=${result.errors} total=${result.total}`,
  );
  return result;
}

main()
  .then(async (res) => {
    await prisma.$disconnect();
    if (res.errors > 0 && res.created === 0 && res.skipped === 0) {
      console.error(
        `[backfill-demo-subscriptions] системный сбой: все ${res.errors} Org упали, ни одной подписки не создано`,
      );
      process.exit(1);
    }
    if (res.errors > 0) {
      console.warn(
        `[backfill-demo-subscriptions] завершено с предупреждениями: ${res.errors} Org пропущено из-за ошибок (перезапусти скрипт для добивки). Выкат не блокируется.`,
      );
    }
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[backfill-demo-subscriptions] fatal:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
