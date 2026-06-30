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
    key: 'goals.author_coverage_min',
    value: 0.6,
    category: 'goals',
    section: 'goal_vector',
    severity: 'medium',
    description:
      'Минимальная доля (0..1) commitment с непустым автором (commitmentAuthorPersonId) в прогоне goal-vector. При покрытии ниже порога атрибуция kept/broken на этот прогон откатывается на адресата (recipient), чтобы не выбросить молча обещания с NULL-автором. По умолчанию 0.6.',
  },
  {
    key: 'probe.reply_latency_rise.factor',
    value: 2,
    category: 'operations',
    section: 'probe',
    severity: 'low',
    description:
      'Во сколько раз должна вырасти средняя задержка ответа сотрудника за 14 дней относительно личного baseline (15-90 дней), чтобы сработал risk-триггер «реже отвечает» (reply_latency_rise). По умолчанию 2.',
  },
  {
    key: 'probe.workload_overload.load_percent',
    value: 120,
    category: 'operations',
    section: 'probe',
    severity: 'low',
    description:
      'Порог загрузки по активным назначениям (Appointment.loadPercent, строго больше), при превышении которого срабатывает risk-триггер перегрузки (workload_overload). По умолчанию 120 (%).',
  },
  {
    key: 'probe.meeting_noshows.count',
    value: 3,
    category: 'operations',
    section: 'probe',
    severity: 'low',
    description:
      'Минимум неявок на завершённые встречи за 28 дней (приглашён, но не присоединился), при котором срабатывает risk-триггер пропуска встреч (meeting_noshows). По умолчанию 3.',
  },

  {
    key: 'blocker_synthesis.lookback_days',
    value: 7,
    category: 'operations',
    section: 'blocker_synthesis',
    severity: 'low',
    description:
      'Окно накопления блокеров (дней) для синтеза: за сколько прошлых дней искать повторения кластера. По умолчанию 7.',
  },
  {
    key: 'blocker_synthesis.recurring_days',
    value: 2,
    category: 'operations',
    section: 'blocker_synthesis',
    severity: 'low',
    description:
      'С какого daysOpen повторяющийся кластер блокеров считается хроническим и мостится в инсайт-радар (Insight). По умолчанию 2.',
  },
  {
    key: 'blocker_synthesis.impact.base',
    value: 1,
    category: 'operations',
    section: 'blocker_synthesis',
    severity: 'low',
    description: 'Базовый вес бизнес-удара за каждый блок в кластере блокеров. По умолчанию 1.',
  },
  {
    key: 'blocker_synthesis.impact.customer',
    value: 4,
    category: 'operations',
    section: 'blocker_synthesis',
    severity: 'low',
    description: 'Бонус бизнес-удара, если блокер задевает клиента/выручку/сделку. По умолчанию 4.',
  },
  {
    key: 'blocker_synthesis.impact.deadline',
    value: 3,
    category: 'operations',
    section: 'blocker_synthesis',
    severity: 'low',
    description: 'Бонус бизнес-удара, если блокер задевает дедлайн/срок/релиз. По умолчанию 3.',
  },
  {
    key: 'blocker_synthesis.impact.commitment',
    value: 2,
    category: 'operations',
    section: 'blocker_synthesis',
    severity: 'low',
    description:
      'Бонус бизнес-удара, если блокер задевает обещание/договорённость. По умолчанию 2.',
  },
  {
    key: 'blocker_synthesis.impact.per_day_open',
    value: 0.5,
    category: 'operations',
    section: 'blocker_synthesis',
    severity: 'low',
    description:
      'Множитель бизнес-удара за каждый день, что блокер открыт (хроника тяжелее). По умолчанию 0.5.',
  },
  {
    key: 'operations.blocker_synthesis.enabled',
    value: true,
    category: 'operations',
    section: 'blocker_synthesis',
    severity: 'medium',
    description:
      'Аварийный рубильник (kill-switch) дневного синтеза блокеров (cron 22:00). Выкл → синтез не строится, мост в инсайты не работает. По умолчанию ВКЛ.',
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
  console.log('=== seed-admin-setting-execution-agents START ===');

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
  console.log('=== seed-admin-setting-execution-agents DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-execution-agents FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
