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
    key: 'ideas.feed.rerank.weight',
    value: 1,
    category: 'operations',
    section: 'ideas_feed',
    severity: 'low',
    description:
      'Вклад нормированного веса идеи в ре-ранк ленты идей (GET /ideas/top). По умолчанию 1.',
  },
  {
    key: 'ideas.feed.rerank.freshness',
    value: 0.5,
    category: 'operations',
    section: 'ideas_feed',
    severity: 'low',
    description: 'Вклад свежести (lastDiscussedAt) в ре-ранк ленты идей. По умолчанию 0.5.',
  },
  {
    key: 'ideas.feed.rerank.goal_link',
    value: 0.75,
    category: 'operations',
    section: 'ideas_feed',
    severity: 'low',
    description: 'Бонус ре-ранка идеи за привязку к цели (goalId != null). По умолчанию 0.75.',
  },
  {
    key: 'ideas.feed.freshness_days',
    value: 30,
    category: 'operations',
    section: 'ideas_feed',
    severity: 'low',
    description:
      'Окно свежести идеи (дней): идея, обсуждавшаяся раньше этого срока, даёт 0 по свежести. По умолчанию 30.',
  },
  {
    key: 'ideas.feed.enabled',
    value: true,
    category: 'operations',
    section: 'ideas_feed',
    severity: 'medium',
    description:
      'Аварийный рубильник (kill-switch) ленты идей и авто-продвижения статуса идеи при закрытии связанной задачи. По умолчанию ВКЛ.',
  },

  {
    key: 'insight.recheck_days',
    value: 14,
    category: 'operations',
    section: 'insights_recheck',
    severity: 'low',
    description:
      'Через сколько дней после митигации перепроверять инсайт: если паттерн повторился — вернуть в active. По умолчанию 14.',
  },
  {
    key: 'insights.recheck.enabled',
    value: true,
    category: 'operations',
    section: 'insights_recheck',
    severity: 'medium',
    description:
      'Аварийный рубильник (kill-switch) re-check митигированных инсайтов (в insight-clusterer cron). По умолчанию ВКЛ.',
  },

  {
    key: 'operations.knowledge_at_risk.enabled',
    value: true,
    category: 'operations',
    section: 'knowledge_at_risk',
    severity: 'medium',
    description:
      'Аварийный рубильник (kill-switch) еженедельного синтеза знание-под-риском (cron пн 05:00, push только руководителю). По умолчанию ВКЛ.',
  },

  {
    key: 'team_capacity.overload_percent',
    value: 120,
    category: 'operations',
    section: 'team_capacity',
    severity: 'low',
    description:
      'Порог средней загрузки отдела (Appointment.loadPercent, строго больше), при котором команда помечается перегруженной. По умолчанию 120 (%).',
  },
  {
    key: 'team_capacity.underload_percent',
    value: 50,
    category: 'operations',
    section: 'team_capacity',
    severity: 'low',
    description:
      'Порог средней загрузки отдела (строго меньше), при котором команда помечается недозагруженной. По умолчанию 50 (%).',
  },
  {
    key: 'operations.team_capacity.enabled',
    value: true,
    category: 'operations',
    section: 'team_capacity',
    severity: 'medium',
    description:
      'Аварийный рубильник (kill-switch) capacity-агрегата по командам (endpoint /dashboard/operations/team-capacity + строка в COO-дайджесте). По умолчанию ВКЛ.',
  },

  {
    key: 'onboarding.silent_days',
    value: 5,
    category: 'operations',
    section: 'onboarding_ramp',
    severity: 'low',
    description:
      'За сколько дней молчания (0 артефактов/вопросов к памяти) новичок считается не активировавшимся (stalled). По умолчанию 5.',
  },
  {
    key: 'operations.onboarding_ramp.enabled',
    value: true,
    category: 'operations',
    section: 'onboarding_ramp',
    severity: 'medium',
    description:
      'Аварийный рубильник (kill-switch) дневного онбординг-рампа новичка (cron 07:00, push руководителю + новичку). По умолчанию ВКЛ.',
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
  console.log('=== seed-admin-setting-knowledge-improvement-agents START ===');

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
  console.log('=== seed-admin-setting-knowledge-improvement-agents DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-knowledge-improvement-agents FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
