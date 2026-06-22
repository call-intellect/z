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
    key: 'tracker.assigneeMatchMaxEdits',
    value: 2,
    category: 'tracker',
    section: 'workers',
    severity: 'low',
    description:
      'Допуск опечаток/склонений при поиске исполнителя по имени (расстояние Левенштейна на общей основе). По умолчанию 2, диапазон 0–4. 0 — только точное совпадение.',
  },
  {
    key: 'tracker.progressAutoDraftEnabled',
    value: true,
    category: 'tracker',
    section: 'workers',
    severity: 'high',
    description:
      'Рубильник воркера авто-черновика прогресса задач из графа знаний. По умолчанию вкл (Ship-On).',
  },
  {
    key: 'tracker.progressAutoDraftMinSignals',
    value: 2,
    category: 'tracker',
    section: 'workers',
    severity: 'low',
    description:
      'Минимум дельта-сигналов по задаче для создания авто-черновика прогресса. По умолчанию 2 (минимум 1).',
  },
  {
    key: 'tracker.progressAutoDraftCron',
    value: '0 7 * * *',
    category: 'tracker',
    section: 'workers',
    severity: 'low',
    description:
      'Кадэнс (cron) воркера авто-черновика прогресса. По умолчанию ежедневно в 07:00 UTC.',
  },
  {
    key: 'tracker.activityDigestEnabled',
    value: true,
    category: 'tracker',
    section: 'workers',
    severity: 'high',
    description:
      'Рубильник AI-сводки изменений по задаче (catch-up «что произошло»). По умолчанию вкл (Ship-On).',
  },
  {
    key: 'tracker.automationsEnabled',
    value: true,
    category: 'tracker',
    section: 'workers',
    severity: 'high',
    description:
      'Рубильник пользовательских автоматизаций трекера (правила if-this-then-that). По умолчанию вкл (Ship-On). Выкл — движок не применяет ни одно правило.',
  },
  {
    key: 'tracker.recurrenceEnabled',
    value: true,
    category: 'tracker',
    section: 'workers',
    severity: 'high',
    description:
      'Рубильник воркера материализации повторяющихся задач. По умолчанию вкл (Ship-On). Выкл — повторения не создают новые задачи.',
  },
  {
    key: 'tracker.recurrenceCronCadence',
    value: '0 6 * * *',
    category: 'tracker',
    section: 'workers',
    severity: 'low',
    description:
      'Кадэнс (cron) воркера материализации повторяющихся задач. По умолчанию ежедневно в 06:00 UTC.',
  },
  {
    key: 'tracker.overdueNotifyEnabled',
    value: true,
    category: 'ai',
    section: 'tracker',
    severity: 'high',
    description:
      'Слать исполнителю уведомление о просрочке задачи (in_app + Telegram). Рубильник, по умолчанию вкл (Ship-On).',
  },
  {
    key: 'tracker.assigneeClarifyEnabled',
    value: true,
    category: 'ai',
    section: 'tracker',
    severity: 'high',
    description:
      'Дозапрашивать исполнителя задачи через уточняющий вопрос (probe), если не определён. Рубильник, по умолчанию вкл (Ship-On).',
  },
  {
    key: 'tracker.dueDateClarifyEnabled',
    value: true,
    category: 'ai',
    section: 'tracker',
    severity: 'medium',
    description:
      'Дозапрашивать срок задачи через уточняющий вопрос (probe), если не указан. Рубильник, по умолчанию вкл (Ship-On).',
  },
  {
    key: 'tracker.assigneeProbePriorityHint',
    value: 0.7,
    category: 'ai',
    section: 'tracker',
    severity: 'low',
    description:
      'Приоритет уточняющего вопроса об исполнителе задачи (0–1). По умолчанию 0.7.',
  },
  {
    key: 'tracker.chatboxTasksInTriageEnabled',
    value: true,
    category: 'ai',
    section: 'tracker',
    severity: 'medium',
    description:
      'Показывать задачи из чатов в общей ленте триажа /intake (read-union). Рубильник, по умолчанию вкл (Ship-On).',
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
  console.log('=== seed-admin-setting-tracker START ===');

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
  console.log('=== seed-admin-setting-tracker DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-tracker FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
