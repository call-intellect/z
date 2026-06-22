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
    key: 'taskClosure.enabled',
    value: true,
    category: 'operations',
    section: 'workers',
    severity: 'high',
    description:
      'Аварийный рубильник петли авто-закрытия задач (сигнал «сделал X» из разговора → кандидат на закрытие). По умолчанию вкл (Ship-On). Выкл — кандидаты не создаются.',
  },
  {
    key: 'taskClosure.matchThreshold',
    value: 0.85,
    category: 'operations',
    section: 'workers',
    severity: 'medium',
    description:
      'Порог косинусной близости (KNN) сигнала к открытой задаче, выше которого считаем задачу найденной. По умолчанию 0.85, диапазон 0–1. Ниже — пробуем лексический fallback.',
  },
  {
    key: 'taskClosure.embedTimeoutMs',
    value: 2500,
    category: 'operations',
    section: 'workers',
    severity: 'low',
    description:
      'Таймаут синхронного расчёта embedding текста сигнала (мс). По умолчанию 2500. Таймаут — сигнал пропускается best-effort.',
  },
  {
    key: 'taskClosure.candidateTtlDays',
    value: 14,
    category: 'operations',
    section: 'workers',
    severity: 'low',
    description:
      'Срок жизни (дни) кандидата на закрытие до автоматической чистки. По умолчанию 14.',
  },
  {
    key: 'taskClosure.lexicalFallbackMinOverlap',
    value: 0.5,
    category: 'operations',
    section: 'workers',
    severity: 'medium',
    description:
      'Минимальная доля токенов названия задачи, встретившихся в тексте сигнала, для лексического fallback (когда KNN ниже порога). По умолчанию 0.5, диапазон 0–1. LLM-верификатор всё равно финально гейтит.',
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
  console.log('=== seed-admin-setting-task-closure START ===');

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
  console.log('=== seed-admin-setting-task-closure DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-task-closure FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
