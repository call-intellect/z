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
    key: 'knowledge.segment_max_tokens',
    value: 600,
    category: 'ai',
    section: 'knowledge',
    severity: 'medium',
    description:
      'Размер под-чанка нарезки транскрипта перед извлечением блоков (в токенах, 200–2000). Эффективный размер сегмента; верхняя граница остаётся blockIngestMaxTokensPerSegment. По умолчанию 600.',
  },
  {
    key: 'knowledge.segment_overlap_ratio',
    value: 0.2,
    category: 'ai',
    section: 'knowledge',
    severity: 'medium',
    description:
      'Доля перекрытия (0–1) между соседними под-чанками: хвост предыдущего сегмента повторяется в начале следующего, чтобы не терять контекст на границе. По умолчанию 0.2.',
  },
  {
    key: 'knowledge.contextual_header_enabled',
    value: true,
    category: 'ai',
    section: 'knowledge',
    severity: 'high',
    description:
      'Рубильник LLM-обогащения контекст-заголовка перед эмбеддингом блока (Contextual Retrieval): к блоку добавляется одно предложение про встречу. При выкл — только детерминированная метастрока. По умолчанию вкл (Ship-On).',
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
  console.log('=== seed-admin-setting-knowledge-graph START ===');

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
  console.log('=== seed-admin-setting-knowledge-graph DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-knowledge-graph FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
