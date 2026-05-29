/**
 * Backfill для ТЗ paywall-no-trial Фаза 5.1.
 *
 * Задача: для каждого `Org` без записи `Subscription` создать
 * Subscription { status: 'DEMO' }. Это закрывает grandfather-сценарий:
 * Org'и, которые были созданы до внедрения paywall (когда OrgsService
 * ещё не вызывал ensureDemo), всё равно получают paywall-блокировку
 * мутаций — без падения SubscriptionGuard на NULL-подписке.
 *
 * Запуск:
 *   docker compose exec backend bun run scripts/backfill-demo-subscriptions.ts
 *
 * Идемпотентен: повторный запуск пропускает Org'и, у которых уже есть
 * Subscription (любого статуса — ACTIVE/DEMO/SUSPENDED/...).
 *
 * См. правила safe-seed-rules: используем findFirst+create вместо upsert
 * (потому что у Subscription нет составного unique key с status), не
 * перезаписываем существующие записи.
 *
 * Источник: plans/tz/2026-05-28-paywall-no-trial.md §6.1.
 */

import { SubscriptionEventType } from '@prisma/client';

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

  console.log(
    `[backfill-demo-subscriptions] Найдено ${orgs.length} активных Org`,
  );

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
          eventType: SubscriptionEventType.CREATED,
          payload: { initial: true, backfill: 'backfill-demo-subscriptions' },
        },
      });
      result.created += 1;
      console.log(
        `  ✓ ${org.name} (${org.id}) — создана DEMO-подписка ${created.id}`,
      );
    } catch (err) {
      result.errors += 1;
      console.error(
        `  ✗ ${org.name} (${org.id}) — ошибка: ${
          err instanceof Error ? err.message : String(err)
        }`,
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
    if (res.errors > 0) {
      process.exit(1);
    }
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[backfill-demo-subscriptions] fatal:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
