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
  {
    key: 'knowledge.entity_name_resolve_threshold',
    value: 0.9,
    category: 'ai',
    section: 'knowledge',
    severity: 'medium',
    description:
      'Порог cosine-сходства (0–1) для эмбеддинг-склейки упомянутого имени с реальным сотрудником при резолве «кто это» (например «Настя» → аккаунт). Кандидат принимается только при единственном совпадении ≥ порога; при двух и более — неоднозначность, склейка не выполняется (fail-closed). По умолчанию 0.9.',
  },
  {
    key: 'knowledge.edge_confidence_high',
    value: 0.85,
    category: 'ai',
    section: 'knowledge',
    severity: 'high',
    description:
      'Высокий порог уверенности (0–1) для рискованных связей графа (противоречие/замещение/причинность): такие связи прячут или меняют версии фактов. Создаются только при уверенности ≥ порога И подтверждении судьёй-скептиком. По умолчанию 0.85.',
  },
  {
    key: 'knowledge.edge_confidence_low',
    value: 0.6,
    category: 'ai',
    section: 'knowledge',
    severity: 'medium',
    description:
      'Базовый порог уверенности (0–1) для обычных смысловых связей графа (развивает/следствие/отвечает/закрывает). По умолчанию 0.6.',
  },
  {
    key: 'knowledge.linker_min_canonical',
    value: 2,
    category: 'ai',
    section: 'knowledge',
    severity: 'medium',
    description:
      'Минимум канонических блоков в Org, при котором смысловой линкер начинает строить связи (убирает гейт-лаг при малом графе). По умолчанию 2.',
  },
  {
    key: 'knowledge.linker_candidate_topk',
    value: 12,
    category: 'ai',
    section: 'knowledge',
    severity: 'low',
    description:
      'Сколько ближайших по вектору блоков-кандидатов рассматривает смысловой линкер для одного нового блока. По умолчанию 12.',
  },
  {
    key: 'knowledge.structural_shares_entity_topk',
    value: 10,
    category: 'ai',
    section: 'knowledge',
    severity: 'low',
    description:
      'Максимум структурных рёбер shares_entity (общая сущность), которые детерминированно создаются для одного блока при ingest (без LLM). По умолчанию 10.',
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
