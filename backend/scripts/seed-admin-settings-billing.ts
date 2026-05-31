/**
 * Seed: 6 ключей billing.* для tier_standard (admin-plans-collapse-to-standard Фаза 1).
 *
 * Идём по правилам `safe-seed-rules`:
 *   - findUnique по key — если запись есть, пропускаем БЕЗ перетирания
 *     (защита админ-правок: super_admin мог уже изменить цену через UI);
 *   - если записи нет — создаём с дефолтом из ТЗ §3.1;
 *   - в конце печатаем сводку «создано: N, пропущено: M».
 *
 * Дефолты передаются жёстко в коде (это «code-fallback» по терминологии
 * AdminSetting). ENV-овых аналогов нет.
 *
 * Запуск (из backend/):
 *   bun run scripts/seed-admin-settings-billing.ts
 *
 * ТЗ: plans/tz/2026-05-31-admin-plans-collapse-to-standard.md §3.1, §4 Фаза 1.
 */

import type { Prisma } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

// ─────────────────────────────── seeds ───────────────────────────────────

type Severity = 'low' | 'medium' | 'high' | 'destructive';

interface BillingSettingSeed {
  key: string;
  value: number;
  description: string;
}

const SEEDS: BillingSettingSeed[] = [
  {
    key: 'billing.baseMonthlyKopecks',
    value: 6_000_000,
    description: 'Базовая цена tier_standard в копейках (месяц)',
  },
  {
    key: 'billing.perExtraSeatKopecks',
    value: 100_000,
    description: 'Цена дополнительного места сверх базовых, в копейках (месяц)',
  },
  {
    key: 'billing.yearlyDiscountRate',
    value: 0.8,
    description: 'Множитель цены при годовой оплате (0.8 = -20%)',
  },
  {
    key: 'billing.baseSeatsIncluded',
    value: 31,
    description: 'Сколько мест включено в базовый tier_standard',
  },
  {
    key: 'billing.baseMeetingsGrant',
    value: 150,
    description: 'Грант встреч на месяц для tier_standard',
  },
  {
    key: 'billing.perExtraSeatMeetingsGrant',
    value: 5,
    description: 'Дополнительный грант встреч за каждое доп. место',
  },
];

const CATEGORY = 'billing';
const SECTION = 'tariff-standard';
const SEVERITY: Severity = 'high';

// ─────────────────────────────── main ────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== seed-admin-settings-billing START ===');

  let created = 0;
  let skipped = 0;

  for (const seed of SEEDS) {
    // Защита админ-правок: если ключ уже существует — не трогаем value,
    // не трогаем метаданные (super_admin мог настроить через UI).
    const existing = await prisma.adminSetting.findUnique({
      where: { key: seed.key },
      select: { key: true },
    });

    if (existing) {
      skipped++;
      console.log(`  skip  ${seed.key} (уже есть)`);
      continue;
    }

    await prisma.adminSetting.create({
      data: {
        key: seed.key,
        value: seed.value as Prisma.InputJsonValue,
        category: CATEGORY,
        section: SECTION,
        severity: SEVERITY,
        description: seed.description,
        schemaId: null,
        updatedBy: null,
      },
    });
    created++;
    console.log(`  +     ${seed.key} = ${seed.value}`);
  }

  console.log('=== seed-admin-settings-billing SUMMARY ===');
  console.log(`создано: ${created}, пропущено: ${skipped}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('seed-admin-settings-billing: ERROR', err);
    await prisma.$disconnect();
    process.exit(1);
  });
