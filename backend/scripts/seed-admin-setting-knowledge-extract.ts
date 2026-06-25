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
    key: 'knowledge.decisionsExtractMinConfidence',
    value: 0.4,
    category: 'knowledge',
    section: 'specialists',
    severity: 'low',
    description:
      'Порог уверенности извлекателя решений (specialist-3-3): черновик решения с confidence ниже порога не материализуется. По умолчанию 0.4, диапазон 0–1. Для более строгого отсева псевдо-решений можно поднять до 0.5 (калибровать по diag-тесту).',
  },
  {
    key: 'knowledge.ideasExtractMinConfidence',
    value: 0.4,
    category: 'knowledge',
    section: 'specialists',
    severity: 'low',
    description:
      'Порог уверенности извлекателя идей (specialist-3-6): идея с confidence ниже порога не материализуется. По умолчанию 0.4, диапазон 0–1.',
  },
  {
    key: 'knowledge.insightsExtractMinConfidence',
    value: 0.4,
    category: 'knowledge',
    section: 'specialists',
    severity: 'low',
    description:
      'Порог уверенности извлекателя инсайтов (specialist-3-5): инсайт с confidence ниже порога не материализуется. По умолчанию 0.4, диапазон 0–1.',
  },
  {
    key: 'knowledge.decisionsDedupeThreshold',
    value: 0.86,
    category: 'knowledge',
    section: 'specialists',
    severity: 'low',
    description:
      'Порог косинусной близости авто-дедупа решений: при сходстве ≥ порога черновик сливается с существующим решением БЕЗ LLM-арбитра. По умолчанию 0.86, диапазон 0–1. Выше — строже (реже авто-merge).',
  },
  {
    key: 'knowledge.decisionsDedupeGrayBand',
    value: 0.07,
    category: 'knowledge',
    section: 'specialists',
    severity: 'low',
    description:
      'Ширина серой зоны дедупа решений: при сходстве в [порог − зона; порог) вердикт выносит LLM/debate-арбитр, а не одна косинусная близость. Ниже [порог − зона] — сразу «новое». По умолчанию 0.07, диапазон 0–1.',
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
  console.log('=== seed-admin-setting-knowledge-extract START ===');

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
  console.log('=== seed-admin-setting-knowledge-extract DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-knowledge-extract FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
