/**
 * TZ-1 Фаза 1 (daily-value-engine) — Seed AdminSetting для радара клиентов
 * под риском.
 *
 * Регистрирует ключи динамической конфигурации:
 *   - `customer_risk.window_days` (int, default 14) — окно накопления сигналов.
 *   - `customer_risk.weight.churn_risk` (int, default 5) — вес сигнала «отток».
 *   - `customer_risk.weight.objection` (int, default 3) — вес «возражение».
 *   - `customer_risk.weight.pain` (int, default 2) — вес «боль».
 *   - `customer_risk.weight.feature_request` (int, default 1) — вес «доработка».
 *   - `customer_risk.threshold.critical` (int, default 10) — порог critical.
 *   - `customer_risk.threshold.warning` (int, default 4) — порог warning.
 *   - `operations.customer_risk_radar.enabled` (boolean, default true) —
 *     kill-switch радара. ON (Ship-On).
 *
 * Запуск:
 *   bun run scripts/seed-admin-setting-customer-risk.ts
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - Если AdminSetting уже редактировался super_admin'ом (`updatedBy != null`
 *     и `updatedBy != 'system'`) — НЕ перезаписываем `value`, обновляем только
 *     метаданные (category/section/severity/description).
 *   - Системная запись — обновим value на текущий fallback.
 */

import { type Prisma } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

type Severity = 'low' | 'medium' | 'high' | 'destructive';

interface SettingSeed {
  key: string;
  value: unknown;
  category: string;
  section: string;
  severity: Severity;
  description: string;
}

const SEEDS: SettingSeed[] = [
  {
    key: 'customer_risk.window_days',
    value: 14,
    category: 'operations',
    section: 'customer_risk',
    severity: 'low',
    description:
      'Окно накопления клиентских сигналов (дней) для радара клиентов под риском. По умолчанию 14.',
  },
  {
    key: 'customer_risk.weight.churn_risk',
    value: 5,
    category: 'operations',
    section: 'customer_risk',
    severity: 'medium',
    description:
      'Вес сигнала «риск оттока» в взвешенной сумме риска клиента. Самый весомый. По умолчанию 5.',
  },
  {
    key: 'customer_risk.weight.objection',
    value: 3,
    category: 'operations',
    section: 'customer_risk',
    severity: 'medium',
    description: 'Вес сигнала «возражение» в риске клиента. По умолчанию 3.',
  },
  {
    key: 'customer_risk.weight.pain',
    value: 2,
    category: 'operations',
    section: 'customer_risk',
    severity: 'medium',
    description: 'Вес сигнала «боль клиента» в риске клиента. По умолчанию 2.',
  },
  {
    key: 'customer_risk.weight.feature_request',
    value: 1,
    category: 'operations',
    section: 'customer_risk',
    severity: 'low',
    description:
      'Вес сигнала «запрос доработки» в риске клиента. Наименее весомый. По умолчанию 1.',
  },
  {
    key: 'customer_risk.threshold.critical',
    value: 10,
    category: 'operations',
    section: 'customer_risk',
    severity: 'medium',
    description:
      'Порог взвешенного риска, с которого клиент считается критическим (riskLevel=critical). По умолчанию 10.',
  },
  {
    key: 'customer_risk.threshold.warning',
    value: 4,
    category: 'operations',
    section: 'customer_risk',
    severity: 'low',
    description:
      'Порог взвешенного риска, с которого клиент считается повышенным (riskLevel=warning). По умолчанию 4.',
  },
  {
    key: 'operations.customer_risk_radar.enabled',
    value: true,
    category: 'operations',
    section: 'customer_risk',
    severity: 'medium',
    description:
      'Kill-switch дневного радара клиентов под риском (cron 21:00, COO-дайджест + push менеджеру). true (Ship-On).',
  },
];

interface Counters {
  created: number;
  updated: number;
  skippedAdminEdited: number;
}

async function upsertSetting(seed: SettingSeed, counters: Counters): Promise<void> {
  const existing = await prisma.adminSetting.findUnique({
    where: { key: seed.key },
    select: { updatedBy: true },
  });
  const valueInput = seed.value as Prisma.InputJsonValue;

  if (!existing) {
    await prisma.adminSetting.create({
      data: {
        key: seed.key,
        value: valueInput,
        category: seed.category,
        section: seed.section,
        severity: seed.severity,
        description: seed.description,
      },
    });
    counters.created++;
    console.log(`[create] ${seed.key}`);
    return;
  }

  // Admin-edited — не трогаем value, обновляем только метаданные.
  if (existing.updatedBy && existing.updatedBy !== 'system') {
    await prisma.adminSetting.update({
      where: { key: seed.key },
      data: {
        category: seed.category,
        section: seed.section,
        severity: seed.severity,
        description: seed.description,
      },
    });
    counters.skippedAdminEdited++;
    console.log(`[skip:admin-edited] ${seed.key}`);
    return;
  }

  await prisma.adminSetting.update({
    where: { key: seed.key },
    data: {
      value: valueInput,
      category: seed.category,
      section: seed.section,
      severity: seed.severity,
      description: seed.description,
    },
  });
  counters.updated++;
  console.log(`[update] ${seed.key}`);
}

async function main(): Promise<void> {
  console.log('=== seed-admin-setting-customer-risk START ===');

  const counters: Counters = {
    created: 0,
    updated: 0,
    skippedAdminEdited: 0,
  };

  for (const seed of SEEDS) {
    await upsertSetting(seed, counters);
  }

  console.log(
    `created=${counters.created}, updated=${counters.updated}, skipped_admin_edited=${counters.skippedAdminEdited}`,
  );
  console.log('=== seed-admin-setting-customer-risk DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-customer-risk FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
