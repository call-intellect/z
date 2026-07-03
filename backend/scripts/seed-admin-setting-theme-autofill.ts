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
    key: 'theme.autofill.enabled',
    value: true,
    category: 'knowledge',
    section: 'theme_autofill',
    severity: 'medium',
    description: 'Kill-switch авто-наполнения пользовательских тем. true=включено.',
  },
  {
    key: 'theme.autofill.threshold',
    value: 0.72,
    category: 'knowledge',
    section: 'theme_autofill',
    severity: 'medium',
    description:
      'Порог косинусной близости для авто-добавления блока в тему. Диапазон 0..1, по умолчанию 0.72.',
  },
  {
    key: 'theme.autofill.scanWindowDays',
    value: 14,
    category: 'knowledge',
    section: 'theme_autofill',
    severity: 'low',
    description:
      'Окно свежих блоков (дней), сканируемых для авто-наполнения. По умолчанию 14.',
  },
  {
    key: 'theme.autofill.maxPerScan',
    value: 50,
    category: 'knowledge',
    section: 'theme_autofill',
    severity: 'low',
    description: 'Потолок авто-добавлений за один проход на тему. По умолчанию 50.',
  },
  {
    key: 'theme.autofill.dedupeSimilarity',
    value: 0.97,
    category: 'knowledge',
    section: 'theme_autofill',
    severity: 'low',
    description:
      'Порог near-дубля: кандидат не добавляется, если косинус к уже выбранному ≥ этого. Диапазон 0..1, по умолчанию 0.97.',
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
  console.log('=== seed-admin-setting-theme-autofill START ===');

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

  console.log('=== seed-admin-setting-theme-autofill DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-theme-autofill FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
