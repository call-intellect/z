/**
 * Migrate (ТЗ 2026-05-27 billing-tochka-referral-dadata-z) — миграция legacy
 * тарифов `tier_basic` / `tier_pro` / `tier_enterprise` → целевой `tier_standard`.
 *
 * После реализации ТЗ продукт идёт на едином тарифе `tier_standard` (все фичи
 * `true`, единая цена 60 000 ₽/мес + 1 000 ₽/доп.место). См.
 * `plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md` Фаза 1.4.
 *
 * Что делает:
 *   1. Находит все `OrgEntitlement` с `tier IN ('tier_basic','tier_pro','tier_enterprise')`.
 *   2. Обновляет `tier='tier_standard'`. `featureOverrides`/`quotaOverrides`
 *      сохраняем как есть — они продолжают работать поверх `tier_standard`.
 *   3. Логирует каждое изменение (orgId, oldTier → 'tier_standard').
 *
 * Идемпотентность: повторный запуск не меняет уже мигрированные записи
 * (`where: { tier: { in: [legacy...] } }`).
 *
 * Запуск:
 *   bun run scripts/migrate-entitlements-to-standard.ts          — реальная миграция
 *   bun run scripts/migrate-entitlements-to-standard.ts --dry-run — только подсчёт
 *
 * Через docker compose (prod):
 *   docker compose exec backend bun run scripts/migrate-entitlements-to-standard.ts
 */

import { createPrismaClient } from './_lib/prisma';

const DRY_RUN = process.argv.includes('--dry-run');

const LEGACY_TIERS = ['tier_basic', 'tier_pro', 'tier_enterprise'] as const;
const TARGET_TIER = 'tier_standard';

interface Counters {
  scanned: number;
  migrated: number;
  byOldTier: Record<string, number>;
}

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  const counters: Counters = {
    scanned: 0,
    migrated: 0,
    byOldTier: { tier_basic: 0, tier_pro: 0, tier_enterprise: 0 },
  };

  // eslint-disable-next-line no-console
  console.log(
    `=== migrate-entitlements-to-standard START (dryRun=${DRY_RUN}) ===`,
  );

  try {
    const candidates = await prisma.orgEntitlement.findMany({
      where: { tier: { in: [...LEGACY_TIERS] } },
      select: { tenantId: true, tier: true },
    });
    counters.scanned = candidates.length;

    if (candidates.length === 0) {
      // eslint-disable-next-line no-console
      console.log('Нет legacy-tier записей. Миграция не требуется.');
      return;
    }

    for (const row of candidates) {
      const oldTier = row.tier;
      counters.byOldTier[oldTier] = (counters.byOldTier[oldTier] ?? 0) + 1;

      // eslint-disable-next-line no-console
      console.log(
        `  org=${row.tenantId}  ${oldTier} → ${TARGET_TIER}${DRY_RUN ? '  [dry-run]' : ''}`,
      );

      if (!DRY_RUN) {
        await prisma.orgEntitlement.update({
          where: { tenantId: row.tenantId },
          data: { tier: TARGET_TIER },
        });
        counters.migrated += 1;
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  // eslint-disable-next-line no-console
  console.log(
    `=== migrate-entitlements-to-standard DONE ===\n` +
      `  scanned: ${counters.scanned}\n` +
      `  migrated: ${counters.migrated}\n` +
      `  byOldTier: ${JSON.stringify(counters.byOldTier)}\n` +
      `  dryRun: ${DRY_RUN}`,
  );
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('FATAL', err);
  process.exit(1);
});
