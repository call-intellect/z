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
    key: 'dashboard.main_rework.enabled',
    value: true,
    category: 'dashboard',
    section: 'main',
    severity: 'medium',
    description:
      'Kill-switch (ON): новая компоновка главной директора — первый экран ≤7 величин (Польза/Настроение/Обещания/Висящие решения/Компас/AI-сводка/Top-1 риск), единый компас, «Что узнали», сворачивание виджетов знаний в drill-down. OFF возвращает прежнюю раскладку первого экрана.',
  },
  {
    key: 'dashboard.stuck.staleDaysThreshold',
    value: 5,
    category: 'dashboard',
    section: 'main',
    severity: 'low',
    description:
      'Порог «зависшей» задачи (в днях) для кросс-проектного экрана руководителя: задача без движения дольше этого срока считается зависшей. По умолчанию 5.',
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
  console.log('=== seed-admin-setting-dashboard-main START ===');

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
  console.log('=== seed-admin-setting-dashboard-main DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-dashboard-main FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
