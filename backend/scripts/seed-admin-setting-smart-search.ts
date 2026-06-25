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
    key: 'concierge.max_steps',
    value: 6,
    category: 'ai',
    section: 'smart_search',
    severity: 'medium',
    description:
      'Лимит шагов петли инструментов помощника «Мастер» на один шаг плана. При достижении — честный частичный ответ «не хватило шагов», не пустота. По умолчанию 6.',
  },
  {
    key: 'rag.loop_guard_threshold',
    value: 1,
    category: 'ai',
    section: 'smart_search',
    severity: 'medium',
    description:
      'Сколько раз допускается повтор нормализованного поискового запроса до остановки детерминированным сторожем зацикливания (без LLM). По умолчанию 1.',
  },
  {
    key: 'rag.rrf_k',
    value: 60,
    category: 'ai',
    section: 'smart_search',
    severity: 'low',
    description:
      'Параметр k для слияния рангов RRF при объединении результатов нескольких подзапросов поиска (стандартно 60). По умолчанию 60.',
  },
  {
    key: 'rag.k_retrieve',
    value: 30,
    category: 'ai',
    section: 'smart_search',
    severity: 'medium',
    description:
      'Сколько блоков-кандидатов поднимать в пул поиска (до реранка): больший пул даёт реранку из чего выбирать. По умолчанию 30.',
  },
  {
    key: 'rag.k_context',
    value: 18,
    category: 'ai',
    section: 'smart_search',
    severity: 'medium',
    description:
      'Сколько отобранных блоков уходит в контекст синтеза ответа (после реранка). Должно быть ≤ rag.k_retrieve. По умолчанию 18.',
  },
  {
    key: 'rag.rerank_min_pool',
    value: 12,
    category: 'ai',
    section: 'smart_search',
    severity: 'medium',
    description:
      'Минимальный размер пула кандидатов, при котором включается LLM-реранк (на меньшем/чистом пуле реранк бесполезен и только дороже). По умолчанию 12.',
  },
  {
    key: 'rag.multiquery_count',
    value: 3,
    category: 'ai',
    section: 'smart_search',
    severity: 'low',
    description:
      'Сколько переформулировок вопроса строит мульти-запрос для повышения полноты поиска. По умолчанию 3.',
  },
  {
    key: 'rag.groundedness_mode',
    value: 'on',
    category: 'ai',
    section: 'smart_search',
    severity: 'high',
    description:
      'Режим гейта честности (заземления) после синтеза: "on" — не подтверждён блоками → честный отказ; "shadow" — только метрика, ответ не меняется (наблюдение over-abstention); "off" — выключен. По умолчанию "on".',
  },
  {
    key: 'rag.iterative_enabled',
    value: true,
    category: 'ai',
    section: 'smart_search',
    severity: 'medium',
    description:
      'Разрешает многошаговую ветку (роутер сложности → ReWOO-план → достаточность) для агрегатных вопросов. Выкл → всегда одношаговый ответ. По умолчанию вкл.',
  },
  {
    key: 'rag.cold_start_min_blocks',
    value: 20,
    category: 'ai',
    section: 'smart_search',
    severity: 'medium',
    description:
      'Нижний порог объёма памяти Org (число канонических блоков), ниже которого тяжёлая многошаговая ветка не запускается — простой одношаговый режим (защита от cold-start у новых тенантов). По умолчанию 20.',
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
  console.log('=== seed-admin-setting-smart-search START ===');

  const counters: Counters = { created: 0, updated: 0, skippedAdminEdited: 0 };
  for (const seed of SEEDS) {
    await upsertSetting(seed, counters);
  }

  console.log(
    `created=${counters.created}, updated=${counters.updated}, skipped_admin_edited=${counters.skippedAdminEdited}`,
  );
  console.log('=== seed-admin-setting-smart-search DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-smart-search FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
