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
    key: 'operations.weekly_digest.raw_char_budget',
    value: 60000,
    category: 'operations',
    section: 'weekly_digest',
    severity: 'low',
    description:
      'Бюджет символов на дневные письма недели во входе промпта «Неделя компании». При превышении самые поздние дни опускаются, отчёт не падает.',
  },
  {
    key: 'operations.digest.team_friction_min_confidence',
    value: 0.7,
    category: 'operations',
    section: 'digest',
    severity: 'low',
    description:
      'Мин. уверенность трения команды, чтобы оно учитывалось в оси «Команда» вердикта недели/месяца.',
  },
  {
    key: 'operations.digest.team_friction_repeat_count',
    value: 2,
    category: 'operations',
    section: 'digest',
    severity: 'low',
    description:
      'Сколько трений выше порога уверенности за период понижают ось «Команда» до «риск» (повторяемость).',
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
  console.log('=== seed-admin-setting-week-month-v2 START ===');

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

  console.log('=== seed-admin-setting-week-month-v2 DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-week-month-v2 FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
