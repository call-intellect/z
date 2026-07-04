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
    key: 'table.graphsync.enabled',
    value: true,
    category: 'tables',
    section: 'agent',
    severity: 'low',
    description:
      'Аварийный рубильник graphSync-наполнения умных таблиц: авто-создание строк из графовых объектов (Goal→«Цели», Experiment→«Гипотезы», IdeaBlock signalType=idea→«Идеи», commitment→«Обещания»). По умолчанию ON. Выключать только при инциденте (мусорные строки) — тогда false.',
  },
  {
    key: 'table.graphsync.min_confidence',
    value: 0.5,
    category: 'tables',
    section: 'agent',
    severity: 'low',
    description:
      'Минимальная уверенность графового объекта для авто-создания строки таблицы через graphSync (0..1). По умолчанию 0.5 — включительно с дефолтной уверенностью извлечённых блоков/экспериментов (0.5), т.к. граф уже курирован (canonical). Объекты без confidence (созданные человеком) считаются доверенными (эфф. 1.0). Объекты ниже порога не отбрасываются, а создаются как черновик (status=draft) — вне чата до подтверждения.',
  },
  {
    key: 'table.agent.draft_ttl_days',
    value: 14,
    category: 'tables',
    section: 'agent',
    severity: 'low',
    description:
      'Срок жизни черновой строки таблицы (status=draft) в днях. Черновик создаётся из низкоуверенного графового объекта, вне чата; при усилении (объект дорос до порога) промоутится в active. Не промоутнутый за это время — истекает (soft-delete) на reconcile-проходе. По умолчанию 14.',
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
  console.log('=== seed-admin-setting-table-graphsync START ===');

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
  console.log('=== seed-admin-setting-table-graphsync DONE ===');
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error('seed-admin-setting-table-graphsync FAILED:', err);
      process.exit(1);
    })
    .finally(async () => {
      void prisma.$disconnect();
    });
}

export { SEEDS };
