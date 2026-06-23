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
    key: 'clone.regulations.retrieval.top_n',
    value: 6,
    category: 'knowledge',
    section: 'clone_regulations',
    severity: 'low',
    description:
      'Сколько записанных правил должности подтягивать в ответ клона (топ по смысловой близости). По умолчанию 6.',
  },
  {
    key: 'clone.regulations.retrieval.min_similarity',
    value: 0.3,
    category: 'knowledge',
    section: 'clone_regulations',
    severity: 'low',
    description:
      'Порог смысловой близости (косинусная дистанция): правила дальше порога в ответ клона не подмешиваются. По умолчанию 0.30.',
  },
  {
    key: 'clone.regulations.snapshot.max_items',
    value: 20,
    category: 'knowledge',
    section: 'clone_regulations',
    severity: 'low',
    description:
      'Размер указателя-снимка правил должности (компактный список заголовков, который клон «знает»). По умолчанию 20.',
  },
  {
    key: 'clone.regulations.scope.include_org',
    value: true,
    category: 'knowledge',
    section: 'clone_regulations',
    severity: 'low',
    description:
      'Подмешивать ли правила уровня всей компании вдобавок к правилам самой должности. По умолчанию включено.',
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
  console.log('=== seed-admin-setting-clone-regulations START ===');

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
  console.log('=== seed-admin-setting-clone-regulations DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-clone-regulations FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
