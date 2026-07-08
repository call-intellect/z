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
    key: 'me.tasks.doneWindowDays',
    value: 14,
    category: 'me',
    section: 'tasks',
    severity: 'low',
    description:
      'Окно (в днях) для букета «Сделано» на борде задач сотрудника /me/tasks/buckets: закрытые задачи с completedAt за последние N дней. По умолчанию 14.',
  },
  {
    key: 'operations.personal_day_narrative.enabled',
    value: true,
    category: 'operations',
    section: 'workers',
    severity: 'high',
    description:
      'Kill-switch (ON): вечернее письмо-отчёт «Твой день» — LLM пишет каждому сотруднику короткое личное письмо (что сделал / зависло / обещал / вклад) + 4 оси-статуса. Веером по одному на человека по его таймзоне (кэш общего префикса). OFF → письма не генерятся, /me/day-letter отдаёт пусто.',
  },
  {
    key: 'operations.personal_day_narrative.morning_hour',
    value: 7,
    category: 'operations',
    section: 'workers',
    severity: 'low',
    description:
      'Час локального времени сотрудника (0–23), в который УТРОМ генерится и рассылается письмо-отчёт «Твой день» про ВЧЕРАШНИЙ день. По умолчанию 7.',
  },
  {
    key: 'operations.self_signals.plan_not_closing_streak_days',
    value: 3,
    category: 'operations',
    section: 'workers',
    severity: 'low',
    description:
      'Порог сигнала «план не закрывается N дней подряд» на стенде сотрудника: число подряд идущих вечерних чек-инов с непустым списком «не сделано». Поведенческий сигнал (не настроение). По умолчанию 3.',
  },
  {
    key: 'knowledge.expertise.self_max_blocks_scanned',
    value: 2000,
    category: 'knowledge',
    section: 'workers',
    severity: 'low',
    description:
      'Верхний предел числа блоков автора при агрегации профиля экспертизы /me/expertise (топ тем/сущностей, по которым сотрудник — носитель знания). По умолчанию 2000.',
  },
  {
    key: 'knowledge.expertise.self_top_k',
    value: 10,
    category: 'knowledge',
    section: 'workers',
    severity: 'low',
    description:
      'Сколько топовых тем/сущностей возвращать в профиле экспертизы /me/expertise. По умолчанию 10.',
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
  console.log('=== seed-admin-setting-employee-stand START ===');

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
  console.log('=== seed-admin-setting-employee-stand DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-employee-stand FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
