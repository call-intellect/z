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
    key: 'knowledge.entityConsolidateSameNameEnabled',
    value: true,
    category: 'knowledge',
    section: 'graph',
    severity: 'low',
    description:
      'Аварийный рубильник крон-консолидатора одноимённых сущностей (entity-consolidate-same-name, каждый час :40): находит Entity с одинаковым именем (в т.ч. разных типов) и сливает их в одну каноническую через LLM-арбитра + матрицу приоритета типов. По умолчанию ON. Выключать только при инциденте (ложные слияния) — тогда false.',
  },
  {
    key: 'knowledge.entityConsolidateSameNameBatchSize',
    value: 200,
    category: 'knowledge',
    section: 'graph',
    severity: 'low',
    description:
      'Сколько групп одноимённых сущностей крон-консолидатор обрабатывает за один проход на каждый Org. По умолчанию 200. Выше — быстрее расшивка исторических дублей, но дольше проход и больше вызовов LLM-арбитра за раз.',
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
  console.log('=== seed-admin-setting-entity-consolidate START ===');

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
  console.log('=== seed-admin-setting-entity-consolidate DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-entity-consolidate FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
