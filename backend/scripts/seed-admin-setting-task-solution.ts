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
    key: 'aiFeatures.taskSolutionEnabled',
    value: true,
    category: 'ai',
    section: 'task_solution',
    severity: 'high',
    description:
      'Рубильник сущности «Решение задачи» (суточная сборка + витрина). По умолчанию вкл (Ship-On). Выкл → крон task-solution-build no-op.',
  },
  {
    key: 'taskSolution.buildHourMsk',
    value: 3,
    category: 'ai',
    section: 'task_solution',
    severity: 'low',
    description:
      'Час суточной сборки решений задач (0–23, МСК). По умолчанию 3.',
  },
  {
    key: 'taskSolution.minSignalChars',
    value: 40,
    category: 'ai',
    section: 'task_solution',
    severity: 'low',
    description:
      'Порог содержательности «как решалось» (сумма символов блоков). Ниже → не материализуем. По умолчанию 40.',
  },
  {
    key: 'taskSolution.lookbackHours',
    value: 48,
    category: 'ai',
    section: 'task_solution',
    severity: 'low',
    description:
      'Окно детекции задач с новыми how-solved сигналами (часы). По умолчанию 48.',
  },
  {
    key: 'taskSolution.repeatThreshold',
    value: 3,
    category: 'ai',
    section: 'task_solution',
    severity: 'low',
    description:
      'Сколько похожих решений (включая себя) → кандидат в инструкцию. По умолчанию 3.',
  },
  {
    key: 'taskSolution.repeatSimilarity',
    value: 0.85,
    category: 'ai',
    section: 'task_solution',
    severity: 'low',
    description:
      'Cosine-порог похожести решений для группировки повторов. По умолчанию 0.85.',
  },
  {
    key: 'taskSolution.refineEnabled',
    value: true,
    category: 'ai',
    section: 'task_solution',
    severity: 'medium',
    description:
      'Аварийный рубильник LLM-уточнения решения: гейт содержательности («само решилось» → не материализуем) + рост клонов соисполнителей (кто реально решал → в subjects). По умолчанию вкл (Ship-On). Выкл → материализация по длине сигнала + subjects=только владелец.',
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
  console.log('=== seed-admin-setting-task-solution START ===');

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
  console.log('=== seed-admin-setting-task-solution DONE ===');
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error('seed-admin-setting-task-solution FAILED:', err);
      process.exit(1);
    })
    .finally(async () => {
      void prisma.$disconnect();
    });
}

export { SEEDS };
