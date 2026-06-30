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
    key: 'tracker.morningDigest.enabled',
    value: true,
    category: 'tracker',
    section: 'workers',
    severity: 'high',
    description:
      'Рубильник утренней сводки открытых задач сотруднику. По умолчанию вкл (Ship-On). Выкл — дайджест не рассылается.',
  },
  {
    key: 'tracker.morningDigest.hourMsk',
    value: 9,
    category: 'tracker',
    section: 'workers',
    severity: 'medium',
    description:
      'Час рассылки утренней сводки задач по московскому времени. По умолчанию 9, диапазон 0–23.',
  },
  {
    key: 'tracker.morningDigest.channels',
    value: ['in_app', 'email_smtp', 'telegram_bot', 'max_bot'],
    category: 'tracker',
    section: 'workers',
    severity: 'medium',
    description:
      'Набор каналов доставки утренней сводки задач. Допустимые значения: in_app, email_smtp, telegram_bot, max_bot, push. По умолчанию in_app + email_smtp + telegram_bot + max_bot.',
  },
  {
    key: 'tracker.morningDigest.maxItemsTotal',
    value: 50,
    category: 'tracker',
    section: 'workers',
    severity: 'low',
    description:
      'Максимум задач в письме утренней сводки; остальные сворачиваются в «и ещё N». По умолчанию 50, диапазон 1–500.',
  },
  {
    key: 'tracker.morningDigest.sendWhenEmpty',
    value: true,
    category: 'tracker',
    section: 'workers',
    severity: 'low',
    description:
      'Слать утреннюю сводку «всё чисто», даже если открытых задач у сотрудника нет. По умолчанию вкл.',
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
  console.log('=== seed-admin-setting-morning-tasks-digest START ===');

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
  console.log('=== seed-admin-setting-morning-tasks-digest DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-morning-tasks-digest FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
